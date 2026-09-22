import os
import threading
import boto3
import pandas as pd
from botocore.exceptions import NoCredentialsError, ClientError
import io
from dotenv import load_dotenv

load_dotenv()

def _credential(*names):
    """
    First of these environment variables that is set.

    Two names each, because the deployed environment cannot use the original ones:
    Vercel functions run on Lambda, which owns every AWS_* name, so the dashboard
    rejects AWS_ACCESS_KEY as reserved. S3_* is what production sets; AWS_* still
    works so an existing local .env keeps running unchanged.
    """
    for name in names:
        value = os.environ.get(name)
        if value:
            return value
    return None


S3_ACCESS_KEY = _credential("S3_ACCESS_KEY", "AWS_ACCESS_KEY")
S3_SECRET_KEY = _credential("S3_SECRET_KEY", "AWS_SECRET_KEY")

if not S3_ACCESS_KEY or not S3_SECRET_KEY:
    # Raised at import, which is also when this module is first loaded by the API.
    # Spelled out because the previous os.environ[...] lookup failed with a bare
    # KeyError that said nothing about which platform expects which name.
    raise RuntimeError(
        "No S3 credentials in the environment. Set S3_ACCESS_KEY and S3_SECRET_KEY "
        "(AWS_ACCESS_KEY / AWS_SECRET_KEY also work locally, but Vercel reserves "
        "the AWS_ prefix)."
    )

BUCKET_NAME = os.environ.get("BUCKET_NAME", "fantassistant-lambda-dev")
# The bucket really lives in us-east-1; this used to be hardcoded to eu-central-1
# with a comment admitting it was a guess. AWS_REGION is reserved on Vercel too.
AWS_REGION = _credential("S3_REGION", "AWS_REGION") or "us-east-1"

_client = None
_client_lock = threading.Lock()

def get_s3_client():
    """
    Return the shared S3 client, creating it on first use.

    Constructing a client per call cost ~1.2s each in session, credential and
    endpoint resolution plus a fresh TLS handshake - the same object took 1.4s
    with a new client versus 0.2s on a reused one. botocore clients are
    thread-safe for client operations, so one instance serves FastAPI's
    sync-endpoint threadpool.
    """
    global _client
    if _client is None:
        with _client_lock:
            if _client is None:
                _client = boto3.client(
                    's3',
                    aws_access_key_id=S3_ACCESS_KEY,
                    aws_secret_access_key=S3_SECRET_KEY,
                    region_name=AWS_REGION,
                )
    return _client

def list_bucket(bucket_name=BUCKET_NAME):
    """
    Return {key: LastModified} for the whole bucket in one round trip (~0.18s).

    One listing is enough to discover the newest CR file and to tell whether any
    cached frame is still current, which replaces a day-by-day probe loop that
    cost up to 15 sequential GETs. Paginated because it is free to do so - the
    bucket holds ~31 objects today, well under the 1000-key page limit.
    """
    client = get_s3_client()
    index = {}
    try:
        for page in client.get_paginator('list_objects_v2').paginate(Bucket=bucket_name):
            for obj in page.get('Contents', []):
                index[obj['Key']] = obj['LastModified']
    except (NoCredentialsError, ClientError) as e:
        print(f"Failed to list bucket {bucket_name}: {e}")
    return index

def save_to_s3(filename, df, bucket_name=BUCKET_NAME):
    """
    Saves the given dataframe to S3 as a CSV.
    """
    s3_client = get_s3_client()
    csv_buffer = io.StringIO()
    df.to_csv(csv_buffer, index=False)
    
    try:
        s3_client.put_object(Bucket=bucket_name, Key=filename, Body=csv_buffer.getvalue())
        print(f"File saved to S3: {filename}")
    except (NoCredentialsError, ClientError) as e:
        print(f"Failed to upload {filename} to S3: {e}")

def load_from_s3(filename, bucket_name=BUCKET_NAME):
    """
    Loads a CSV file from S3 into a pandas DataFrame.
    """
    s3_client = get_s3_client()
    try:
        response = s3_client.get_object(Bucket=bucket_name, Key=filename)
        df = pd.read_csv(response['Body'])
        print(f"Loaded file from S3: {filename}")
        return df
    except ClientError as e:
        print(f"File not found in S3: {filename} - {e}")
        return pd.DataFrame()
    except Exception as e:
        print(f"Error loading {filename}: {e}")
        return pd.DataFrame()
