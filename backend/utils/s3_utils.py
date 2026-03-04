import os
import boto3
import pandas as pd
from botocore.exceptions import NoCredentialsError, ClientError
import io
from dotenv import load_dotenv

load_dotenv()

AWS_ACCESS_KEY = os.environ["AWS_ACCESS_KEY"]
AWS_SECRET_KEY = os.environ["AWS_SECRET_KEY"]
BUCKET_NAME = os.environ.get("BUCKET_NAME", "fantassistant-lambda-dev")

def get_s3_client():
    """Initialize and return an S3 client using credentials."""
    return boto3.client(
        's3',
        aws_access_key_id=AWS_ACCESS_KEY,
        aws_secret_access_key=AWS_SECRET_KEY,
        region_name='eu-central-1' # Guessing region, or default
    )

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
