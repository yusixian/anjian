import type { Locale } from '@/lib/i18n';

export function ScreenshotTranscript({ index, locale }: { index: number; locale: Locale }) {
  if (locale === 'zh') return null;
  return (
    <details className="screenshot-transcript">
      <summary>English transcript of the original screenshot</summary>
      {index === 0 ? (
        <div>
          <p>
            The canvas is titled “Anjian docs · First design round”. It shows light and dark home
            pages, a local setup guide, and an invitation guide. The comments panel has four
            unresolved comments:
          </p>
          <ol>
            <li>“The search icon here is poor.”</li>
            <li>“These icons here are also too small.”</li>
            <li>“Remove the unnecessary extra text.”</li>
            <li>“This area could be more striking — better UI.”</li>
          </ol>
          <p>
            The mockup presents the same local setup, public sharing, and friend-invitation paths
            described on this site's home page. It is the earlier design, not the current interface.
          </p>
        </div>
      ) : (
        <div>
          <p>
            <strong>User:</strong> “Could you first make a simple design for this Fumadocs site
            using Artifacts, so I can look at it before we start?” The user then specifies “anjian”.
          </p>
          <p>
            <strong>Agent:</strong> “Open the Anjian docs design. There are six boards: light and
            dark home pages, local setup, inviting friends, and two mobile versions. They retain
            Anjian branding and the Fumadocs reading layout. I checked for clipping and horizontal
            overflow. These are static designs; docs implementation is paused. You can comment
            directly on the artboard, and we can continue after your review.”
          </p>
          <p>
            <strong>User:</strong> Sends the artboard link and asks, “Read all my comments and fix
            the issues.”
          </p>
          <p>
            <strong>Agent:</strong> “I will read all comments on this artboard, pull the latest
            draft, make changes based on the comments, and check the result.”
          </p>
          <p>
            The conversation also shows elapsed work time and a list of 18 changed files. Those
            historical statements and file counts are not evidence of completed implementation or
            deployment.
          </p>
        </div>
      )}
    </details>
  );
}
