import React from "react";
import { Link } from "react-router-dom";

const contactEmail = (import.meta.env.VITE_CONTACT_EMAIL || "").trim();

/** No form and no backend: just the current contact route for AdSense review. */
export default function Contact() {
  return (
    <div className="min-h-screen bg-cric-bg text-cric-text">
      <div className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
        <h1 className="text-3xl font-black font-raj sm:text-4xl">Contact CricAll</h1>
        <p className="mt-2 text-sm text-cric-muted">
          Questions about CricAll? This page has the current contact details.
        </p>

        <div className="mt-8 space-y-7 text-sm leading-relaxed sm:text-base">
          <section>
            <h2 className="mb-2 text-lg font-black">Email</h2>
            {contactEmail ? (
              <p className="text-cric-muted">
                Write to{" "}
                <a
                  className="font-bold text-cric-accent underline"
                  href={`mailto:${contactEmail}`}
                >
                  {contactEmail}
                </a>
                .
              </p>
            ) : (
              <p className="text-cric-muted">
                Email is not configured here yet. You can contact us through the
                in-app Report an issue option instead.
              </p>
            )}
            <p className="mt-2 text-cric-muted">
              We aim to reply within two working days.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-black">What to contact us about</h2>
            <ul className="list-disc space-y-2 pl-5 text-cric-muted">
              <li>Club onboarding and adding a new tournament</li>
              <li>Account and login issues</li>
              <li>Ad or content complaints</li>
              <li>Copyright and takedown requests</li>
            </ul>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-black">Related pages</h2>
            <p className="text-cric-muted">
              Read our{" "}
              <Link className="font-bold text-cric-accent underline" to="/about">
                About
              </Link>{" "}
              and{" "}
              <Link className="font-bold text-cric-accent underline" to="/privacy">
                Privacy Policy
              </Link>{" "}
              pages for more information.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
