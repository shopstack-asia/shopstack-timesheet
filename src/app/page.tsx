import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { AUTHENTICATED_HOME, WORKSPACE_ROUTES } from '@/lib/workspace/routes';

export default async function Home() {
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect(WORKSPACE_ROUTES.signIn);
  }

  redirect(AUTHENTICATED_HOME);
}

