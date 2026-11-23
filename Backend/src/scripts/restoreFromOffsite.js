// Restore from the encrypted off-site backup.
//
// Deliberately step-by-step so nothing can be restored over the live database by
// accident: list -> download -> decrypt -> restore into a TEMP database ->
// verify counts -> real restore only with --confirm.
//
// Run with no arguments for usage. Credentials come from Backend/.env (MONGO_URL
// and the OFFSITE_* vars); nothing is printed with secrets in it.

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import dotenv from "dotenv";
import { fileURLToPath } from "url";

import { getMongoTarget } from "../utils/mongoTarget.js";
import {
  buildRcloneDownloadArgs,
  buildRcloneListArgs,
  decryptFile,
  parseOffsiteConfig,
  redactOffsite,
  runRclone,
} from "./offsiteBackup.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const DEFAULT_MONGO_CONTAINER = "cricall-mongo";
const DEFAULT_TEMP_DB = "cric-all-restore-temp";

const USAGE = `Usage: node src/scripts/restoreFromOffsite.js <command> [options]

Commands:
  list                         List encrypted off-site files.
  download <objectName>        Download one file and decrypt it into ./restore-from-offsite/
  restore-temp --archive <f>   Restore <f> into a TEMP database (default ${DEFAULT_TEMP_DB}).
  verify --db <name>           Print collection/document counts for a database.
  restore --archive <f> --confirm
                               Restore <f> over the real database (-drop). Needs the
                               literal --confirm flag; run restore-temp + verify first.

Options:
  --archive <path>    Local decrypted .archive.gz file.
  --db <name>         Database to verify.
  --temp-db <name>    Temp database name (default ${DEFAULT_TEMP_DB}).
  --target-db <name>  Target database for the real restore (default: the one in MONGO_URL).
  --source-db <name>  Database name inside the archive (default: the one in MONGO_URL).
  --out <dir>         Download directory (default ./restore-from-offsite).

The passphrase is read from OFFSITE_PASSPHRASE_FILE - never typed on the command
line or stored in this repository.
`;

export function requireConfirm({ confirm } = {}) {
  if (confirm !== true) {
    throw new Error(
      "refusing to restore over the live database without --confirm (run restore-temp and verify first)"
    );
  }
}

export function buildTempRestoreArgs({ container, uri, sourceDb, tempDb }) {
  return [
    "exec",
    "-i",
    container,
    "mongorestore",
    "--uri",
    uri,
    "--gzip",
    "--archive",
    "--nsFrom",
    `${sourceDb}.*`,
    "--nsTo",
    `${tempDb}.*`,
  ];
}

export function buildRealRestoreArgs({ container, uri, sourceDb, targetDb }) {
  return [
    "exec",
    "-i",
    container,
    "mongorestore",
    "--uri",
    uri,
    "--gzip",
    "--archive",
    "--drop",
    "--nsFrom",
    `${sourceDb}.*`,
    "--nsTo",
    `${targetDb}.*`,
  ];
}

export function buildVerifyArgs({ container, uri, dbName }) {
  const literal = JSON.stringify(dbName);
  const script =
    `const d=db.getSiblingDB(${literal});` +
    "const names=d.getCollectionNames().sort();" +
    `const out={database:${literal},collections:names.length,counts:{}};` +
    "for (const c of names) { out.counts[c]=d.getCollection(c).countDocuments({}); }" +
    "print(JSON.stringify(out));";
  return ["exec", container, "mongosh", "--uri", uri, "--quiet", "--eval", script];
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--confirm") options.confirm = true;
    else if (token.startsWith("--")) {
      const key = token.slice(2);
      options[key] = argv[index + 1];
      index += 1;
    }
  }
  return options;
}

function mongoUri() {
  return process.env.MONGO_URL || process.env.MONGODB_URI || process.env.MONGO_URI;
}

function mongoContainer() {
  return process.env.MONGO_CONTAINER_NAME || DEFAULT_MONGO_CONTAINER;
}

// Streams an archive file into `docker exec -i ...` stdin so the archive never
// has to exist inside the container.
export function runMongoCommand(args, { inputFile, spawnImpl = spawn } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl("docker", args, {
      stdio: [inputFile ? "pipe" : "inherit", "inherit", "inherit"],
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`mongo command exited with code ${code}`));
    });
    if (inputFile) {
      const stream = fs.createReadStream(inputFile);
      stream.on("error", reject);
      stream.pipe(child.stdin);
    }
  });
}

function readPassphraseFile(config) {
  if (!config.passphraseFile) throw new Error("OFFSITE_PASSPHRASE_FILE is not set");
  return fs.readFileSync(config.passphraseFile, "utf8").trim();
}

export async function runRestoreCli({
  argv = process.argv.slice(2),
  spawnImpl = spawn,
  log = console,
} = {}) {
  const [command, ...rest] = argv;
  if (!command || command === "help" || command === "--help") {
    log.log(USAGE);
    return 0;
  }

  const config = parseOffsiteConfig();
  if (command === "list") {
    const { stdout } = await runRclone(buildRcloneListArgs(config, "*.enc"), { spawnImpl });
    log.log(stdout.trim() || "(no off-site backup files found)");
    return 0;
  }

  const options = parseArgs(rest);
  const uri = mongoUri();

  if (command === "download") {
    const objectName = rest.find((token) => !token.startsWith("--"));
    if (!objectName) throw new Error("download needs an object name (see `list`)");
    const outDir = options.out || path.resolve(process.cwd(), "restore-from-offsite");
    fs.mkdirSync(outDir, { recursive: true });

    const downloaded = path.join(outDir, path.basename(objectName));
    await runRclone(buildRcloneDownloadArgs(config, objectName, downloaded), { spawnImpl });
    log.log(`downloaded ${downloaded}`);

    if (downloaded.endsWith(".enc")) {
      const plain = downloaded.slice(0, -4);
      await decryptFile(downloaded, plain, readPassphraseFile(config));
      log.log(`decrypted ${plain}`);
      return 0;
    }
    return 0;
  }

  if (command === "restore-temp" || command === "restore" || command === "verify") {
    if (!uri) throw new Error("MONGO_URL / MONGODB_URI / MONGO_URI is required");
  }

  const { databaseName } = getMongoTarget(uri);
  const sourceDb = options["source-db"] || databaseName;

  if (command === "verify") {
    const dbName = options.db || options["temp-db"] || DEFAULT_TEMP_DB;
    await runMongoCommand(buildVerifyArgs({ container: mongoContainer(), uri, dbName }), {
      spawnImpl,
    });
    return 0;
  }

  if (!options.archive) throw new Error(`${command} needs --archive <path>`);

  if (command === "restore-temp") {
    const tempDb = options["temp-db"] || DEFAULT_TEMP_DB;
    log.log(`restoring into TEMP database ${tempDb} (the live database is untouched)`);
    await runMongoCommand(
      buildTempRestoreArgs({ container: mongoContainer(), uri, sourceDb, tempDb }),
      { inputFile: options.archive, spawnImpl }
    );
    log.log(`temp restore done; now run: restoreFromOffsite.js verify --db ${tempDb}`);
    return 0;
  }

  if (command === "restore") {
    requireConfirm({ confirm: options.confirm === true });
    const targetDb = options["target-db"] || databaseName;
    log.log(`--confirm given: restoring into LIVE database ${targetDb}`);
    await runMongoCommand(
      buildRealRestoreArgs({ container: mongoContainer(), uri, sourceDb, targetDb }),
      { inputFile: options.archive, spawnImpl }
    );
    log.log("real restore finished; run `verify --db` to confirm counts");
    return 0;
  }

  throw new Error(`unknown command: ${command}`);
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === __filename.toLowerCase();

if (isMain) {
  runRestoreCli()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error("Restore step failed:", redactOffsite(error.message));
      process.exitCode = 1;
    });
}
