import axios, { AxiosInstance } from 'axios';
import { StaffProfile, ZohoEmployeeResponse } from '@/types';

interface ZohoTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export class ZohoPeopleService {
  private clientId: string;
  private clientSecret: string;
  private refreshToken: string;
  private apiDomain: string;
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;
  private axiosInstance: AxiosInstance;

  constructor() {
    this.clientId = process.env.ZOHO_CLIENT_ID || '';
    this.clientSecret = process.env.ZOHO_CLIENT_SECRET || '';
    this.refreshToken = process.env.ZOHO_REFRESH_TOKEN || '';
    this.apiDomain = process.env.ZOHO_API_DOMAIN || 'https://people.zoho.com';

    if (!this.clientId || !this.clientSecret || !this.refreshToken) {
      throw new Error('Zoho People API credentials are missing');
    }

    this.axiosInstance = axios.create({
      baseURL: this.apiDomain,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Refresh access token using refresh token
   */
  private async refreshAccessToken(): Promise<string> {
    try {
      const response = await axios.post<ZohoTokenResponse>(
        'https://accounts.zoho.com/oauth/v2/token',
        null,
        {
          params: {
            refresh_token: this.refreshToken,
            client_id: this.clientId,
            client_secret: this.clientSecret,
            grant_type: 'refresh_token',
          },
        }
      );

      this.accessToken = response.data.access_token;
      // Set expiry to 55 minutes (tokens typically last 1 hour)
      this.tokenExpiry = Date.now() + response.data.expires_in * 1000 - 5 * 60 * 1000;

      return this.accessToken;
    } catch (error) {
      console.error('Failed to refresh Zoho access token:', error);
      throw new Error('Failed to refresh Zoho access token');
    }
  }

  /**
   * Get valid access token (refresh if needed)
   */
  private async getAccessToken(): Promise<string> {
    if (!this.accessToken || Date.now() >= this.tokenExpiry) {
      return await this.refreshAccessToken();
    }
    return this.accessToken;
  }

  /**
   * Get employee profile by email
   */
  async getEmployeeByEmail(email: string): Promise<StaffProfile | null> {
    try {
      const accessToken = await this.getAccessToken();

      // Zoho People API endpoint to search employees by email
      const response = await this.axiosInstance.get<ZohoEmployeeResponse>(
        '/people/api/forms/P_EmployeeView/records',
        {
          params: {
            searchCriteria: `(Email:equals:${email})`,
          },
          headers: {
            Authorization: `Zoho-oauthtoken ${accessToken}`,
          },
        }
      );

      const employees = response.data.response?.result?.Employees?.row;

      if (!employees || employees.length === 0) {
        return null;
      }

      // Parse Zoho response format
      const employee = employees[0];
      const fields: Record<string, string> = {};

      employee.FL.forEach((field) => {
        fields[field.val] = field.content;
      });

      return {
        EmployeeID: fields.EmployeeID || fields['Employee ID'] || '',
        FirstName: fields.FirstName || fields['First Name'] || '',
        LastName: fields.LastName || fields['Last Name'] || '',
        Nickname: fields.Nickname || '',
        Email: fields.Email || email,
        Position: fields.Position || fields.Designation || '',
      };
    } catch (error) {
      console.error('Error fetching employee from Zoho:', error);
      throw new Error('Failed to fetch employee data from Zoho People');
    }
  }

  /**
   * Get all employees (for admin purposes)
   */
  async getAllEmployees(): Promise<StaffProfile[]> {
    try {
      const accessToken = await this.getAccessToken();

      const response = await this.axiosInstance.get<ZohoEmployeeResponse>(
        '/people/api/forms/P_EmployeeView/records',
        {
          headers: {
            Authorization: `Zoho-oauthtoken ${accessToken}`,
          },
        }
      );

      const employees = response.data.response?.result?.Employees?.row || [];

      return employees.map((employee) => {
        const fields: Record<string, string> = {};
        employee.FL.forEach((field) => {
          fields[field.val] = field.content;
        });

        return {
          EmployeeID: fields.EmployeeID || fields['Employee ID'] || '',
          FirstName: fields.FirstName || fields['First Name'] || '',
          LastName: fields.LastName || fields['Last Name'] || '',
          Nickname: fields.Nickname || '',
          Email: fields.Email || '',
          Position: fields.Position || fields.Designation || '',
        };
      });
    } catch (error) {
      console.error('Error fetching all employees from Zoho:', error);
      throw new Error('Failed to fetch employees from Zoho People');
    }
  }
}

// Singleton instance
let zohoServiceInstance: ZohoPeopleService | null = null;

export function getZohoPeopleService(): ZohoPeopleService {
  if (!zohoServiceInstance) {
    zohoServiceInstance = new ZohoPeopleService();
  }
  return zohoServiceInstance;
}

