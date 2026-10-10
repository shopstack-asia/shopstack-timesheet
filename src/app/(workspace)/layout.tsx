import { WorkspaceFrame } from '@/components/workspace/layout/WorkspaceFrame';

export default function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <WorkspaceFrame>{children}</WorkspaceFrame>;
}
