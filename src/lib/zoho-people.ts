import axios, { AxiosInstance } from 'axios';
import { StaffProfile, ZohoEmployeeResponse, ZohoLeaveApiResponse } from '@/types';
import { format } from 'date-fns';

interface ZohoTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  api_domain?: string;
  scope?: string;
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
    // Default to people.zoho.com - will be updated from token response if needed
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
   * Update API domain from token response
   */
  private updateApiDomain(apiDomain: string) {
    if (apiDomain && apiDomain !== this.apiDomain) {
      // console.log(`[Zoho] Updating API domain from ${this.apiDomain} to ${apiDomain}`);
      this.apiDomain = apiDomain;
      // Recreate axios instance with new base URL
      this.axiosInstance = axios.create({
        baseURL: this.apiDomain,
        headers: {
          'Content-Type': 'application/json',
        },
      });
    }
  }

  /**
   * Refresh access token using refresh token
   */
  private async refreshAccessToken(): Promise<string> {
    try {
      // console.log('[Zoho] Attempting to refresh access token...');
      // console.log('[Zoho] Refresh token:', this.refreshToken ? `${this.refreshToken.substring(0, 20)}...` : 'MISSING');
      // console.log('[Zoho] Client ID:', this.clientId ? `${this.clientId.substring(0, 20)}...` : 'MISSING');
      
      const response = await axios.post<ZohoTokenResponse & { api_domain?: string; scope?: string }>(
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

      // Log scope from response to help debug
      if (response.data.scope) {
        // console.log(`[Zoho] Token scope: ${response.data.scope}`);
      }

      // Update API domain from token response
      // NOTE: For Zoho People API, we should ALWAYS use people.zoho.com
      // even if api_domain in token response is www.zohoapis.com
      // This is because People API endpoints are only available on people.zoho.com
      if (response.data.api_domain) {
        // console.log(`[Zoho] Token response api_domain: ${response.data.api_domain}`);
        // console.log(`[Zoho] For People API, we will use people.zoho.com regardless of api_domain`);
        // Don't update apiDomain - keep using people.zoho.com for People API
        // The api_domain in token response is for other Zoho APIs (CRM, etc.)
      }

      if (!response.data.access_token) {
        console.error('[Zoho] No access token in response:', response.data);
        
        // Check for specific error codes
        if (response.data.error === 'invalid_code') {
          throw new Error(
            'Zoho refresh token is invalid or expired. Please regenerate the refresh token from Zoho API Console.'
          );
        }
        
        throw new Error(
          `No access token received from Zoho. Response: ${JSON.stringify(response.data)}`
        );
      }

      this.accessToken = response.data.access_token;
      // Set expiry to 55 minutes (tokens typically last 1 hour)
      const expiresIn = response.data.expires_in || 3600; // Default to 1 hour if not provided
      this.tokenExpiry = Date.now() + expiresIn * 1000 - 5 * 60 * 1000;

      // console.log('[Zoho] Access token refreshed successfully');
      // console.log('[Zoho] Token expires at:', new Date(this.tokenExpiry).toISOString());

      return this.accessToken;
    } catch (error: any) {
      console.error('[Zoho] Failed to refresh access token:', error);
      
      if (error.response) {
        console.error('[Zoho] Response status:', error.response.status);
        console.error('[Zoho] Response data:', error.response.data);
        
        const errorData = error.response.data;
        
        // Handle specific Zoho error codes
        if (errorData.error === 'invalid_code' || errorData.error === 'invalid_grant') {
          throw new Error(
            'Zoho refresh token is invalid or expired. Please regenerate the refresh token from Zoho API Console (https://api-console.zoho.com/).'
          );
        }
        
        throw new Error(
          `Failed to refresh Zoho access token: ${error.response.status} - ${JSON.stringify(errorData)}`
        );
      } else if (error.request) {
        console.error('[Zoho] No response received');
        throw new Error('No response from Zoho token endpoint. Please check your network connection.');
      } else {
        throw new Error(`Failed to refresh token: ${error.message}`);
      }
    }
  }

  /**
   * Get valid access token (refresh if needed)
   */
  private async getAccessToken(): Promise<string> {
    if (!this.accessToken || Date.now() >= this.tokenExpiry) {
      // console.log('[Zoho] Access token expired or missing, refreshing...');
      return await this.refreshAccessToken();
    }
    // console.log('[Zoho] Using cached access token');
    return this.accessToken;
  }

  /**
   * Expose a safe accessor for other Zoho helpers that need a valid token
   */
  async getValidAccessTokenForApi(): Promise<string> {
    return await this.getAccessToken();
  }

  /**
   * Force refresh token (used when Zoho responds with 401)
   */
  async refreshAccessTokenForApi(): Promise<string> {
    return await this.refreshAccessToken();
  }

  /**
   * Get employee profile by email
   */
  async getEmployeeByEmail(email: string): Promise<StaffProfile | null> {
    try {
      const accessToken = await this.getAccessToken();
      
      if (!accessToken) {
        throw new Error('Access token is null or undefined after refresh');
      }
      
      // console.log(`[Zoho] Searching for employee with email: ${email}`);
      // console.log(`[Zoho] Using API domain: ${this.apiDomain}`);
      // console.log(`[Zoho] Access token: ${accessToken.substring(0, 20)}...`);

      // Zoho People API endpoint to search employees by email
      // When using www.zohoapis.com, the endpoint format is different
      let apiUrl: string;
      let requestConfig: any;
      
      if (this.apiDomain.includes('www.zohoapis.com')) {
        // For www.zohoapis.com, try using people.zoho.com endpoint directly
        // Some Zoho accounts require using people.zoho.com even if api_domain is www.zohoapis.com
        // First, try with www.zohoapis.com endpoint
        apiUrl = '/people/api/forms/P_EmployeeView/records';
        requestConfig = {
          params: {
            searchCriteria: `(Email:equals:${email})`,
          },
          headers: {
            Authorization: `Zoho-oauthtoken ${accessToken}`,
          },
        };
        // console.log(`[Zoho] Using www.zohoapis.com endpoint format`);
      } else {
        // For people.zoho.com, use the standard format
        // Based on working curl command, use GET with searchCriteria as query parameter
        apiUrl = '/people/api/forms/P_EmployeeView/records';
        // URL encode the email in searchCriteria to handle special characters
        const encodedEmail = encodeURIComponent(email);
        requestConfig = {
          params: {
            searchCriteria: `(Email:equals:${encodedEmail})`,
          },
          headers: {
            Authorization: `Zoho-oauthtoken ${accessToken}`,
            'Content-Type': 'application/json',
          },
        };
        // console.log(`[Zoho] Using people.zoho.com endpoint format`);
        // console.log(`[Zoho] Search criteria (encoded): (Email:equals:${encodedEmail})`);
      }
      
      // console.log(`[Zoho] API URL: ${this.apiDomain}${apiUrl}`);
      // console.log(`[Zoho] Search criteria: (Email:equals:${email})`);

      // Use GET request with searchCriteria as query parameter
      // This matches the working curl command format
      const response = await this.axiosInstance.get<ZohoEmployeeResponse>(
        apiUrl,
        requestConfig
      );

      // console.log(`[Zoho] Response status: ${response.status}`);
      // console.log(`[Zoho] Response data type:`, Array.isArray(response.data) ? 'Array' : 'Object');
      // console.log(`[Zoho] Response data preview:`, JSON.stringify(
      //   Array.isArray(response.data) ? response.data.slice(0, 1) : response.data,
      //   null,
      //   2
      // ).substring(0, 500));

      // Handle two response formats:
      // 1. Old format: { response: { result: { Employees: { row: [...] } } } }
      // 2. New format: [{...}, {...}] (direct array)
      let employees: any[] = [];
      
      if (Array.isArray(response.data)) {
        // New format: direct array
        // console.log(`[Zoho] Using new format (direct array)`);
        employees = response.data;
      } else if (response.data.response?.result?.Employees?.row) {
        // Old format: nested structure
        // console.log(`[Zoho] Using old format (nested structure)`);
        employees = response.data.response.result.Employees.row;
      }

      if (!employees || employees.length === 0) {
        // console.log(`[Zoho] No employees found for email: ${email}`);
        return null;
      }

      // Find employee matching the email (case-insensitive)
      // Important: Must filter by exact email match, not just use first result
      let employee: any = null;
      
      const normalizedEmail = email.toLowerCase().trim();
      
      if (Array.isArray(response.data)) {
        // New format: find by email field (case-insensitive)
        employee = employees.find((emp: any) => {
          const empEmail = (emp['Email address'] || emp.Email || emp['Email'] || '').toLowerCase().trim();
          return empEmail === normalizedEmail;
        });
        
        if (!employee && employees.length > 0) {
          console.warn(`[Zoho] Found ${employees.length} employees but none match email: ${email}`);
          console.warn(`[Zoho] First employee email:`, employees[0]['Email address'] || employees[0].Email || 'N/A');
        }
      } else {
        // Old format: filter by email field
        employee = employees.find((emp: any) => {
          const fields: Record<string, string> = {};
          emp.FL.forEach((field: { val: string; content: string }) => {
            fields[field.val] = field.content;
          });
          const empEmail = (fields.Email || fields['Email address'] || '').toLowerCase().trim();
          return empEmail === normalizedEmail;
        });
        
        // If not found, use first result but log warning
        if (!employee && employees.length > 0) {
          console.warn(`[Zoho] Email filter found no match, but ${employees.length} employees returned`);
          console.warn(`[Zoho] Using first result (may not be correct)`);
          employee = employees[0];
        }
      }

      if (!employee) {
        // console.log(`[Zoho] Employee with email ${email} not found in results`);
        return null;
      }
      
      // console.log(`[Zoho] Found matching employee for email: ${email}`);
      // console.log(`[Zoho] Employee:`, employee);

      // Parse employee data based on format
      let fields: Record<string, string> = {};

      if (Array.isArray(response.data)) {
        // New format: direct object with field names as keys
        fields = employee as Record<string, any>;
        
        // console.log(`[Zoho] Found employee (new format):`, {
        //   EmployeeID: fields['Employee ID'] || fields.EmployeeID,
        //   Name: `${fields['First Name'] || fields.FirstName} ${fields['Last Name'] || fields.LastName}`,
        //   Email: fields['Email address'] || fields.Email,
        // });
      } else {
        // Old format: FL array structure
        employee.FL.forEach((field: { val: string; content: string }) => {
          fields[field.val] = field.content;
        });
        
        // console.log(`[Zoho] Found employee (old format):`, {
        //   ...fields,
        // });
      }

      return {
        EmployeeID: fields.EmployeeID || fields['Employee ID'] || '',
        FirstName: fields.FirstName || fields['First Name'] || '',
        LastName: fields.LastName || fields['Last Name'] || '',
        Nickname: fields.Nickname || fields['Preferred Name'] || '',
        Email: fields.Email || fields['Email address'] || email,
        Position: fields.Position || fields.Designation || '',
        Location:
          fields.Location ||
          fields['Work Location'] ||
          fields['Office Location'] ||
          '',
        // ZUID removed - not needed for Leave API
      };
    } catch (error: any) {
      console.error('[Zoho] Error fetching employee from Zoho:', error);
      
      // Provide more detailed error information
      if (error.response) {
        console.error('[Zoho] Response status:', error.response.status);
        console.error('[Zoho] Response data:', error.response.data);
        throw new Error(
          `Zoho API error: ${error.response.status} - ${JSON.stringify(error.response.data)}`
        );
      } else if (error.request) {
        console.error('[Zoho] No response received:', error.request);
        throw new Error('No response from Zoho API. Please check your network connection.');
      } else {
        console.error('[Zoho] Error setting up request:', error.message);
        throw new Error(`Failed to fetch employee data: ${error.message}`);
      }
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
            'Content-Type': 'application/json',
          },
        }
      );

      // Handle two response formats
      let employees: any[] = [];
      
      if (Array.isArray(response.data)) {
        // New format: direct array
        employees = response.data;
      } else if (response.data.response?.result?.Employees?.row) {
        // Old format: nested structure
        employees = response.data.response.result.Employees.row;
      }

      return employees.map((employee) => {
        let fields: Record<string, string> = {};

        if (Array.isArray(response.data)) {
          // New format: direct object with field names as keys
          fields = employee as Record<string, string>;
        } else {
          // Old format: FL array structure
          employee.FL.forEach((field: { val: string; content: string }) => {
            fields[field.val] = field.content;
          });
        }

        return {
          EmployeeID: fields.EmployeeID || fields['Employee ID'] || '',
          FirstName: fields.FirstName || fields['First Name'] || '',
          LastName: fields.LastName || fields['Last Name'] || '',
          Nickname: fields.Nickname || fields['Preferred Name'] || '',
          Email: fields.Email || fields['Email address'] || '',
          Position: fields.Position || fields.Designation || '',
          Location:
            fields.Location ||
            fields['Work Location'] ||
            fields['Office Location'] ||
            '',
        };
      });
    } catch (error) {
      console.error('Error fetching all employees from Zoho:', error);
      throw new Error('Failed to fetch employees from Zoho People');
    }
  }

  /**
   * Fetch leave records for an employee using Zoho People Leave API v2
   * @param employeeId Employee ID (e.g., "S0005") - used to filter records
   * @param fromDate Start date (YYYY-MM-DD)
   * @param toDate End date (YYYY-MM-DD)
   * @returns Raw leave records from Zoho Leave API v2 (filtered by employeeId)
   */
  async fetchLeaveRecords(employeeId: string, fromDate: string, toDate: string): Promise<ZohoLeaveApiResponse> {
    try {
      const accessToken = await this.getAccessToken();

      if (!accessToken) {
        throw new Error('Access token is null or undefined after refresh');
      }

      if (!employeeId) {
        throw new Error('Employee ID is required for Leave API v2');
      }

      // console.log(`[Zoho] Fetching leave records via Leave API v2 for Employee ID: ${employeeId} from ${fromDate} to ${toDate}`);
      // console.log(`[Zoho] Using API domain: ${this.apiDomain}`);

      const apiUrl = '/people/api/v2/leavetracker/leaves/records';
      const requestConfig = {
        params: {
          from: fromDate,
          to: toDate,
          dateFormat: 'yyyy-MM-dd',
          limit: 200,
        },
        headers: {
          Authorization: `Zoho-oauthtoken ${accessToken}`,
          'Content-Type': 'application/json',
        },
      };

      // console.log(`[Zoho] API URL: ${this.apiDomain}${apiUrl}?from=${fromDate}&to=${toDate}`);

      const response = await this.axiosInstance.get<ZohoLeaveApiResponse>(
        apiUrl,
        requestConfig
      );
      console.log('[Zoho] Leave API v2 response', response.data);

      // console.log(`[Zoho] Leave API v2 response status: ${response.status}`);

      // Filter records by EmployeeId
      if (response.data?.records) {
        const filteredRecords: Record<string, any> = {};
        const allRecords = response.data.records;
        
        Object.keys(allRecords).forEach((recordId) => {
          const record = allRecords[recordId];
          if (record.EmployeeId === employeeId) {
            filteredRecords[recordId] = record;
          }
        });
        
        // console.log(`[Zoho] Filtered ${Object.keys(filteredRecords).length} leave records for Employee ID: ${employeeId} out of ${Object.keys(allRecords).length} total records`);
        
        return {
          records: filteredRecords,
        };
      }

      // console.log(`[Zoho] Leave API v2 response data:`, JSON.stringify(response.data, null, 2));
      return response.data;
    } catch (error: any) {
      console.error('[Zoho] Error fetching leave records:', error);

      if (error.response) {
        console.error('[Zoho] Response status:', error.response.status);
        console.error('[Zoho] Response data:', error.response.data);
        throw new Error(
          `Zoho API error: ${error.response.status} - ${JSON.stringify(error.response.data)}`
        );
      } else if (error.request) {
        console.error('[Zoho] No response received:', error.request);
        throw new Error('No response from Zoho API. Please check your network connection.');
      } else {
        console.error('[Zoho] Error setting up request:', error.message);
        throw new Error(`Failed to fetch leave data: ${error.message}`);
      }
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

