import { NextAuthOptions } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import { getZohoPeopleService } from './zoho-people';
import { StaffProfile } from '@/types';

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID || '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    }),
  ],
  debug: process.env.NODE_ENV === 'development',
  callbacks: {
    async signIn({ user, account, profile }) {
      // Only allow @shopstack.asia domain
      const email = user.email || profile?.email;
      
      console.log('[NextAuth] Sign in attempt for email:', email);
      
      if (!email) {
        console.error('[NextAuth] No email found in user profile');
        return false;
      }
      
      if (!email.endsWith('@shopstack.asia')) {
        console.error(`[NextAuth] Access denied: Email ${email} is not from @shopstack.asia domain`);
        return false;
      }

      // Fetch staff profile from Zoho People
      try {
        console.log(`[NextAuth] Fetching staff profile from Zoho People for: ${email}`);
        const zohoService = getZohoPeopleService();
        const staffProfile = await zohoService.getEmployeeByEmail(email);

        if (!staffProfile) {
          console.warn(`[NextAuth] Employee not found in Zoho People: ${email}`);
          return false;
        }

        console.log(`[NextAuth] Staff profile found:`, {
          EmployeeID: staffProfile.EmployeeID,
          Name: `${staffProfile.FirstName} ${staffProfile.LastName}`,
          Position: staffProfile.Position,
        });

        // Store staff profile in user object
        user.staffProfile = staffProfile;
        return true;
      } catch (error) {
        console.error(`[NextAuth] Error fetching staff profile for ${email}:`, error);
        if (error instanceof Error) {
          console.error('[NextAuth] Error details:', {
            message: error.message,
            stack: error.stack,
          });
        }
        return false;
      }
    },
    async jwt({ token, user }) {
      // Persist staff profile in token
      if (user?.staffProfile) {
        token.staffProfile = user.staffProfile;
      }
      return token;
    },
    async session({ session, token }) {
      // Add staff profile to session
      if (token.staffProfile) {
        session.staffProfile = token.staffProfile as StaffProfile;
      }
      return session;
    },
  },
  pages: {
    signIn: '/auth/signin',
    error: '/auth/error',
  },
  session: {
    strategy: 'jwt',
  },
};

// Extend NextAuth types
declare module 'next-auth' {
  interface User {
    staffProfile?: StaffProfile;
  }

  interface Session {
    staffProfile?: StaffProfile;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    staffProfile?: StaffProfile;
  }
}

