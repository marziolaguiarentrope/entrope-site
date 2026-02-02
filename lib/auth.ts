import { NextAuthOptions } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  callbacks: {
    async signIn({ user }) {
      // Only allow @helloaxel.com emails
      const email = user.email;
      if (!email || !email.endsWith('@helloaxel.com')) {
        return false;
      }
      return true;
    },
    async jwt({ token, account }) {
      // Store the Google ID token when the user first signs in
      if (account?.id_token) {
        token.idToken = account.id_token;
      }
      return token;
    },
    async session({ session, token }) {
      // Expose the ID token to the session
      // @ts-expect-error - extending session type
      session.idToken = token.idToken;
      return session;
    },
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },
};
