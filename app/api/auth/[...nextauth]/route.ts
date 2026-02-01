import NextAuth from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';

const handler = NextAuth({
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
    async session({ session }) {
      return session;
    },
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },
});

export { handler as GET, handler as POST };
