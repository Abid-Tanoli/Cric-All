import React from "react";
import { Link } from "react-router-dom";

/** Simple-English privacy/terms page required by Google AdSense. */
export default function Privacy() {
  return (
    <div className="min-h-screen bg-cric-bg text-cric-text">
      <div className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
        <h1 className="text-3xl font-black font-raj sm:text-4xl">Privacy Policy</h1>
        <p className="mt-2 text-sm text-cric-muted">
          Last updated: {new Date().getFullYear()}. This page explains, in simple
          English, what CricAll does with your information.
        </p>

        <div className="mt-8 space-y-7 text-sm leading-relaxed sm:text-base">
          <section>
            <h2 className="mb-2 text-lg font-black">Information we use</h2>
            <p className="text-cric-muted">
              We keep basic account details you give us, such as your name, email
              address, and the teams or organizations you belong to. We also
              store the cricket matches, scores and player details that you or
              your organization add to the site, so that other visitors can see
              them. We do not sell your personal information.
            </p>
          </section>

          <section id="ads">
            <h2 className="mb-2 text-lg font-black">Google AdSense and cookies</h2>
            <p className="text-cric-muted">
              We use Google AdSense to show advertisements. AdSense and its
              partners use cookies and similar technologies to choose ads, measure
              them, and understand how people use the site. This can include your
              IP address and the pages you visit. Google may use this information
              to show you more relevant ads.
            </p>
            <p className="mt-2 text-cric-muted">
              Google shows its own consent message ("Privacy &amp; messaging") on
              our site. We do not show a separate cookie banner. You can change
              your ad personalisation at any time in{" "}
              <a
                className="font-bold text-cric-accent underline"
                href="https://adssettings.google.com"
                target="_blank"
                rel="noreferrer noopener"
              >
                Google Ads Settings
              </a>
              . You can also block or delete cookies in your browser settings.
            </p>
          </section>

          <section id="terms">
            <h2 className="mb-2 text-lg font-black">Terms of use</h2>
            <p className="text-cric-muted">
              Use CricAll only for lawful purposes. Do not try to break the site,
              copy someone else's account, or post content you do not have the
              right to share. Scores and statistics are provided as they are; we
              try to keep them accurate but cannot promise they are always
              error-free. We may change or stop parts of the service.
            </p>
          </section>

          <section id="contact">
            <h2 className="mb-2 text-lg font-black">Contact</h2>
            <p className="text-cric-muted">
              Questions about this page or your data? Please use our{" "}
              <Link className="font-bold text-cric-accent underline" to="/contact">
                Contact page
              </Link>{" "}
              for the current email address and contact topics.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
