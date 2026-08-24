/*
 * The landing page for RoleModel's OpenFrame instance.
 *
 * A separate component rather than edits to LandingPage.tsx, deliberately. That
 * file is 965 lines of upstream's marketing for their hosted product, and this is
 * a fork with a live `upstream` remote — so editing it would put a conflict in
 * every future pull. app/page.tsx chooses between the two, which makes the whole
 * customisation one line that is easy to see and easy to undo.
 *
 * Upstream's page also has to go rather than be trimmed: it hardcodes a pricing
 * section, so with billing switched off our instance was advertising plans nobody
 * can buy, next to comparisons against competitors we are not competing with.
 *
 * Everything here is drawn with the app's own tokens and shadcn primitives. A
 * landing page in a different visual language from the tool it leads into reads as
 * a different product, and the point of the page is to say "this is us".
 */

import Image from 'next/image';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

interface RoleModelLandingProps {
  isLoggedIn: boolean;
}

/*
 * Numbered, because this genuinely is a sequence — a reviewer arrives partway
 * through it and the number tells them where. Ornamental numbering on a set of
 * unordered features is the thing to avoid; this is not that.
 */
const STEPS = [
  {
    title: 'We send you a link',
    body: 'One link per video. No account to create up front, and nothing to install.',
  },
  {
    title: 'You comment on the exact frame',
    body: 'Scrub to the moment, leave a note, draw on it if that is clearer. Every comment carries its timecode, so nothing has to be described in words.',
  },
  {
    title: 'We cut the next version',
    body: 'Revisions land in the same place, so the thread and the video stay together instead of scattering across email.',
  },
];

export function RoleModelLanding({ isLoggedIn }: RoleModelLandingProps) {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex items-center justify-between px-6 py-5 sm:px-10">
        <Link href="/" aria-label="RoleModel Software" className="inline-flex">
          {/* Two files rather than one recoloured: the brand draws a dedicated
              colour-on-dark wordmark, which keeps the green a knocked-out white
              version throws away.

              `unoptimized` because these are SVG. Next's optimizer does nothing
              useful to vector art, and letting it try would mean turning on
              dangerouslyAllowSVG — which is an invitation to serve untrusted SVG
              from a route that takes a URL. Not worth it for two local files. */}
          <Image
            src="/brand/rolemodel-logo.svg"
            alt="RoleModel Software"
            width={168}
            height={34}
            priority
            unoptimized
            className="h-8 w-auto dark:hidden"
          />
          <Image
            src="/brand/rolemodel-logo-color-on-dark.svg"
            alt="RoleModel Software"
            width={168}
            height={34}
            priority
            unoptimized
            className="hidden h-8 w-auto dark:block"
          />
        </Link>
        <Button asChild size="sm">
          <Link href={isLoggedIn ? '/dashboard' : '/login'}>
            {isLoggedIn ? 'Your projects' : 'Sign in'}
          </Link>
        </Button>
      </header>

      <main className="flex-1">
        <section className="mx-auto max-w-3xl px-6 pb-20 pt-16 sm:px-10 sm:pt-24">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-primary">
            Client review
          </p>
          <h1 className="mt-5 text-balance text-4xl font-bold leading-[1.08] tracking-tight sm:text-5xl">
            Review the work, frame by frame.
          </h1>
          <p className="mt-6 max-w-[62ch] text-lg leading-relaxed text-muted-foreground">
            This is where RoleModel Software shares video for review — walkthroughs, demos and
            release notes. Comment on the exact moment you are looking at, and the note arrives
            attached to that frame rather than to a paragraph describing it.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Button asChild size="lg">
              <Link href={isLoggedIn ? '/dashboard' : '/login'}>
                {isLoggedIn ? 'Go to your projects' : 'Sign in'}
              </Link>
            </Button>
            <span className="text-sm text-muted-foreground">
              Access is by invitation — if you are expecting a video, use the link we sent.
            </span>
          </div>
        </section>

        <section
          aria-labelledby="how-it-works"
          className="border-y border-border bg-card/20 px-6 py-16 sm:px-10"
        >
          <div className="mx-auto max-w-3xl">
            <h2 id="how-it-works" className="text-sm font-semibold uppercase tracking-wider">
              How a review goes
            </h2>
            <ol className="mt-8 grid gap-8 sm:grid-cols-3">
              {STEPS.map((step, i) => (
                <li key={step.title}>
                  <span className="font-mono text-xs tabular-nums text-primary">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <h3 className="mt-2 font-semibold">{step.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>
      </main>

      <footer className="mx-auto flex w-full max-w-3xl flex-col gap-2 px-6 py-10 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-10">
        <a href="https://rolemodelsoftware.com" className="hover:text-foreground">
          rolemodelsoftware.com
        </a>
        {/* Credit where it is due: the software under this page is OpenFrame. */}
        <span>
          Built on{' '}
          <a
            href="https://github.com/yusufipk/OpenFrame"
            className="underline decoration-border underline-offset-4 hover:text-foreground"
          >
            OpenFrame
          </a>
        </span>
      </footer>
    </div>
  );
}
