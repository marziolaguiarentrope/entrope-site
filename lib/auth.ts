import { NextAuthOptions } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';

/**
 * Refresh the Google ID token using the stored refresh token.
 * Google's token endpoint returns a new id_token + access_token.
 */
async function refreshGoogleToken(refreshToken: string) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Failed to refresh Google token');
  }

  return {
    idToken: data.id_token as string,
    accessToken: data.access_token as string,
    expiresAt: Math.floor(Date.now() / 1000) + (data.expires_in as number),
    // Google does not rotate refresh tokens by default, so this may be undefined
    refreshToken: data.refresh_token as string | undefined,
  };
}

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          access_type: 'offline',
          prompt: 'consent',
          scope: 'openid email profile',
        },
      },
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
      // Case 1: Initial sign-in — store all tokens from Google
      if (account) {
        return {
          ...token,
          idToken: account.id_token,
          accessToken: account.access_token,
          refreshToken: account.refresh_token,
          expiresAt: account.expires_at, // seconds since epoch
        };
      }

      // Case 2: Token still valid (with 5-minute buffer)
      if (typeof token.expiresAt === 'number' && Date.now() < (token.expiresAt - 300) * 1000) {
        return token;
      }

      // Case 3: Token expired or near expiry — refresh it
      if (!token.refreshToken) {
        console.error('No refresh token available, cannot refresh session');
        return { ...token, error: 'RefreshAccessTokenError' };
      }

      try {
        const refreshed = await refreshGoogleToken(token.refreshToken);
        return {
          ...token,
          idToken: refreshed.idToken,
          accessToken: refreshed.accessToken,
          expiresAt: refreshed.expiresAt,
          refreshToken: refreshed.refreshToken ?? token.refreshToken,
          error: undefined,
        };
      } catch (error) {
        console.error('Error refreshing Google token:', error);
        return { ...token, error: 'RefreshAccessTokenError' };
      }
    },
    async session({ session, token }) {
      // Expose the ID token and any error to the client session
      session.idToken = token.idToken;
      session.error = token.error;
      return session;
    },
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },
};
