import axios from 'axios';

// Assuming backend runs on 8000. In prod this would be env var.
const API_URL = 'http://localhost:8000/api';

export const fetchFilters = async (season) => {
    try {
        const response = await axios.get(`${API_URL}/filters`, { params: { season } });
        return response.data;
    } catch (error) {
        console.error("Error fetching filters", error);
        return { positions: [], min_cr: 0, max_cr: 35 };
    }
};

export const fetchStats = async (params) => {
    try {
        const response = await axios.post(`${API_URL}/stats`, params);
        return response.data;
    } catch (error) {
        console.error("Error fetching stats", error);
        return [];
    }
};

export const fetchAggregatedStats = async (params) => {
    try {
        const response = await axios.post(`${API_URL}/stats/aggregated`, params);
        return response.data;
    } catch (error) {
        console.error("Error fetching aggregated stats", error);
        return [];
    }
};


export const fetchDashboardData = async (season) => {
    try {
        const response = await axios.get(`${API_URL}/dashboard`, { params: { season } });
        return response.data;
    } catch (error) {
        console.error("Error fetching dashboard data", error);
        return { widgets: {}, injuries: [] };
    }
};

export const fetchRecommendations = async (params) => {
    try {
        const response = await axios.post(`${API_URL}/recommend`, params);
        return response.data;
    } catch (error) {
        console.error("Error fetching recommendations", error);
        return [];
    }
};
