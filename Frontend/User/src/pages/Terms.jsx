import React from "react";
import { Link } from "react-router-dom";

/** Short, plain terms of use required by Google AdSense site review. */
export default function Terms() {
  return (
    <div className="min-h-screen bg-cric-bg text-cric-text">
      <div className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
        <h1 className="text-3xl font-black font-raj sm:text-4xl">Terms of Use</h1>
        <p className="mt-2 text-sm text-cric-muted">
          Last updated: {new Date().getFullYear()}. These terms explain the
          basic rules for using CricAll.
        </p>

        <div className="mt-8 space-y-7 text-sm leading-relaxed sm:text-base">
          <section>
            <h2 className="mb-2 text-lg font-black">Acceptable use</h2>
            <p className="text-cric-muted">
              Use CricAll only for lawful purposes. Do not try to break the
              site, copy another person&apos;s account, or post content you do
              not have the right to share.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-black">Content ownership</h2>
            <p className="text-cric-muted">
              Clubs and organizations keep ownership of the team details,
              scorecards and stories they add. By adding them to CricAll, you
              allow other visitors to view those pages on the site.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-black">Accuracy of scores</h2>
            <p className="text-cric-muted">
              Scores are entered by the people running or scoring a match. We
              try to keep them accurate, but we cannot promise that every score
              or statistic is error-free.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-black">Liability limit</h2>
            <p className="text-cric-muted">
              CricAll is provided as it is. To the extent allowed by law, we are
              not responsible for loss that comes from using the site or from
              relying on match information shown on it.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-black">Changes</h2>
            <p className="text-cric-muted">
              We may change or stop parts of the service. If you have a question
              about these terms, please use our{" "}
              <Link className="font-bold text-cric-accent underline" to="/contact">
                Contact page
              </Link>
              .
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
