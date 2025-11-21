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
  callbacks: {
    async signIn({ user, account, profile }) {
      // Only allow @shopstack.asia domain
      const email = user.email || profile?.email;
      if (!email || !email.endsWith('@shopstack.asia')) {
        return false;
      }

      // Fetch staff profile from Zoho People
      try {
        const zohoService = getZohoPeopleService();
        const staffProfile = await zohoService.getEmployeeByEmail(email);

        if (!staffProfile) {
          console.warn(`Employee not found in Zoho People: ${email}`);
          return false;
        }

        // Store staff profile in user object
        user.staffProfile = staffProfile;
        return true;
      } catch (error) {
        console.error('Error fetching staff profile:', error);
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

