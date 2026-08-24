import { after } from 'next/server';
// Ours, not upstream's. LandingPage.tsx is 965 lines of marketing for their
// hosted product — including a hardcoded pricing section, which with billing off
// advertised plans nobody can buy. It is left untouched rather than trimmed,
// because this fork tracks an `upstream` remote and editing it would put a
// conflict in every pull. Swapping the import is the whole customisation.
import { RoleModelLanding } from '@/components/RoleModelLanding';
import { auth } from '@/lib/auth';
import { readPageVisitor, recordVisitorEvent } from '@/lib/analytics/visitor';

export default async function HomePage() {
  const session = await auth();
  const isLoggedIn = Boolean(session?.user);

  // Signed-in users land here too, and counting them would put existing
  // customers at the top of the acquisition funnel.
  if (!isLoggedIn) {
    const visitor = await readPageVisitor();
    after(() => recordVisitorEvent('LANDING_VIEW', visitor));
  }

  return <RoleModelLanding isLoggedIn={isLoggedIn} />;
}
