'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

function ErrorContent() {
  const searchParams = useSearchParams();
  const error = searchParams.get('error');

  let errorMessage = 'There was an error during authentication. Please try again.';
  let errorDetails = '';

  switch (error) {
    case 'AccessDenied':
      errorMessage = 'Access Denied';
      errorDetails = 'Your email address is not authorized to access this system.';
      break;
    case 'Configuration':
      errorMessage = 'Configuration Error';
      errorDetails = 'There is a problem with the server configuration. Please contact support.';
      break;
    case 'Verification':
      errorMessage = 'Verification Error';
      errorDetails = 'The verification token has expired or has already been used.';
      break;
    default:
      if (error) {
        errorDetails = `Error code: ${error}`;
      }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
      <div className="max-w-md w-full space-y-8 p-8 bg-white dark:bg-gray-800 rounded-lg shadow-md">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">{errorMessage}</h2>
          <p className="mt-4 text-gray-600 dark:text-gray-400">{errorDetails}</p>
          
          {error === 'AccessDenied' && (
            <div className="mt-6 p-4 bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-800 rounded-lg text-left">
              <p className="text-sm text-yellow-800 dark:text-yellow-200 font-semibold mb-2">Possible reasons:</p>
              <ul className="text-sm text-yellow-700 dark:text-yellow-300 list-disc list-inside space-y-1">
                <li>Your email is not from @shopstack.asia domain</li>
                <li>Your email is not registered in Zoho People</li>
                <li>There was an error connecting to Zoho People API</li>
                <li className="font-semibold text-red-600 dark:text-red-400">Zoho refresh token may be expired or invalid - check server logs</li>
              </ul>
              <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-3">
                💡 <strong>Tip:</strong> Check the terminal/server logs for detailed error messages.
              </p>
            </div>
          )}
        </div>
        
        <div className="text-center">
          <Link
            href="/auth/signin"
            className="inline-block px-6 py-3 bg-blue-600 dark:bg-blue-700 text-white rounded-lg hover:bg-blue-700 dark:hover:bg-blue-800 transition-colors"
          >
            Return to Sign In
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function AuthErrorPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-lg text-gray-900 dark:text-white">Loading...</div>
      </div>
    }>
      <ErrorContent />
    </Suspense>
  );
}

