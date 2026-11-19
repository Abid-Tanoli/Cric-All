import "dotenv/config";
import { resolveMailConfig, sendMail } from "../utils/mailer.js";

const [recipient] = process.argv.slice(2);
const config = resolveMailConfig();

if (config.requestedDriver !== "smtp") {
  console.error(`Refusing to run: MAIL_DRIVER must be smtp (currently "${config.requestedDriver}").`);
  process.exit(1);
}
if (config.missing.length > 0) {
  console.error(`Refusing to run: missing ${config.missing.join(", ")}.`);
  process.exit(1);
}
if (!recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
  console.error("Usage: npm run mail:test -- someone@example.com");
  process.exit(1);
}

const result = await sendMail({
  to: recipient,
  subject: "CricAll SMTP test",
  text: "This is a test email from the CricAll backend mail configuration.",
});

if (result.delivered) {
  console.log("OK");
} else {
  console.error(`ERROR: ${result.error || "mail delivery failed"}`);
  process.exit(1);
}
