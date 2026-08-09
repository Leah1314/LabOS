/**
 * A local re-implementation of VoiceOS's own manifest validator.
 *
 * `bunx @voiceos/integration-sdk validate` is unavailable (the package is not
 * published during developer preview), so these rules were read off the zod
 * schema and cross-field checks inside VoiceOS.app itself. Keeping them here
 * means a broken manifest fails on our laptop instead of at install time.
 *
 * Rules that are easy to get wrong, and that the web docs describe loosely:
 *   - `permissions` is an ARRAY of {kind}, not an object of booleans
 *   - `execution.estimatedDurationMs`, not ...Seconds
 *   - the confirmation `footer` lives INSIDE `root` and is an array
 *   - an `actions` block carries `items: [{label, role}]`, not `children`
 *   - exactly one `confirm` and one `cancel` role
 *   - confirmation `keyValue` uses `rows`, while a glance `keyValue` uses `pairs`
 */
import { readFileSync } from "node:fs";

const ID_RE = /^[a-z0-9]+(\.[a-z0-9-]+)+$/;
const VERSION_RE = /^\d+\.\d+\.\d+/;
const TOOL_NAME_RE = /^[a-z][a-z0-9_]*$/;
const PREF_NAME_RE = /^[a-zA-Z][a-zA-Z0-9_]*$/;

const PERMISSION_KINDS = new Set(["network", "notify", "background", "store", "webhook"]);
const PREF_TYPES = new Set(["text", "password", "boolean", "select", "number"]);
const INPUT_BLOCKS = new Set(["textField", "passwordField", "select", "toggle", "chips"]);

const isObject = (v) => v && typeof v === "object" && !Array.isArray(v);
const nonEmpty = (v) => typeof v === "string" && v.trim().length > 0;

function walk(block, visit) {
  if (!isObject(block)) return;
  visit(block);
  for (const key of ["children", "footer", "items", "rows"]) {
    const value = block[key];
    if (Array.isArray(value)) value.forEach((child) => walk(child, visit));
  }
}

export function validateManifest(manifest) {
  const errors = [];
  const e = (msg) => errors.push(msg);

  if (manifest.schemaVersion !== 1) e("schemaVersion must be the literal 1");
  if (!ID_RE.test(manifest.id ?? "")) e("id must be reverse-DNS, e.g. com.acme.my-tool");
  if (!VERSION_RE.test(manifest.version ?? "")) e("version must be semver");
  if (!nonEmpty(manifest.name)) e("name is required");
  if (!nonEmpty(manifest.summary)) e("summary is required");
  else if (manifest.summary.length > 140) e(`summary is ${manifest.summary.length} chars (max 140)`);
  if (!nonEmpty(manifest.publisher?.id) || !nonEmpty(manifest.publisher?.name)) {
    e("publisher.id and publisher.name are required");
  }

  // --- runtime ------------------------------------------------------------
  const runtime = manifest.runtime;
  if (!isObject(runtime)) e("runtime is required");
  else if (runtime.kind === "local-mcp") {
    if (!nonEmpty(runtime.command)) e("local-mcp runtime is missing a command");
    if (runtime.args && !Array.isArray(runtime.args)) e("runtime.args must be an array");
  } else if (runtime.kind === "remote-mcp") {
    if (!nonEmpty(runtime.url)) e("remote-mcp runtime is missing a url");
  } else if (runtime.kind === "hosted") {
    if (!nonEmpty(runtime.entry)) e("hosted runtime is missing an entry");
  } else {
    e(`runtime.kind must be local-mcp | remote-mcp | hosted (got ${runtime.kind})`);
  }

  // --- permissions --------------------------------------------------------
  const permissions = manifest.permissions;
  if (permissions !== undefined) {
    if (!Array.isArray(permissions)) {
      e("permissions must be an ARRAY of { kind } objects, not an object of booleans");
    } else {
      for (const permission of permissions) {
        if (!isObject(permission) || !PERMISSION_KINDS.has(permission.kind)) {
          e(`unknown permission ${JSON.stringify(permission)}`);
          continue;
        }
        if (permission.kind === "network") {
          const domains = permission.domains;
          if (!Array.isArray(domains) || domains.length === 0 || !domains.every(nonEmpty)) {
            e("network permission must list at least one domain");
          }
        }
      }
    }
  }
  const hasPermission = (kind) =>
    Array.isArray(permissions) && permissions.some((p) => p?.kind === kind);

  // --- preferences & name collisions --------------------------------------
  const names = new Map();
  const claim = (name, owner) => {
    const prior = names.get(name);
    if (prior) e(`${owner}.${name} collides with ${prior}.${name}`);
    else names.set(name, owner);
  };
  if (manifest.auth?.kind === "apiKey") {
    for (const field of manifest.auth.fields ?? []) claim(field.name, "auth");
  }
  for (const pref of manifest.preferences ?? []) {
    if (!PREF_NAME_RE.test(pref?.name ?? "")) e("preference name must be an identifier");
    if (!nonEmpty(pref?.title)) e(`preference ${pref?.name} is missing a title`);
    if (!PREF_TYPES.has(pref?.type)) e(`preference ${pref?.name} has an unknown type`);
    if (pref?.type === "select" && !(pref.options?.length > 0)) {
      e(`preference ${pref.name} is a select and must declare options`);
    }
    claim(pref?.name, "preferences");
  }

  // --- tools --------------------------------------------------------------
  const tools = manifest.tools;
  if (!Array.isArray(tools) || tools.length === 0) {
    e("an integration must declare at least one tool");
    return { ok: false, errors };
  }

  for (const tool of tools) {
    const at = `tool ${tool?.name ?? "<unnamed>"}`;
    if (!TOOL_NAME_RE.test(tool?.name ?? "")) e(`${at}: name must be snake_case starting with a letter`);
    if (!nonEmpty(tool?.description)) e(`${at}: description is required`);
    if (!isObject(tool?.inputSchema)) e(`${at}: inputSchema is required`);

    if (tool.execution !== undefined) {
      if (!["sync", "background"].includes(tool.execution.mode)) {
        e(`${at}: execution.mode must be sync or background`);
      }
      if ("estimatedDurationSeconds" in tool.execution) {
        e(`${at}: use execution.estimatedDurationMs, not estimatedDurationSeconds`);
      }
      if (tool.execution.mode === "background" && !hasPermission("background")) {
        e(`${at}: background execution requires the background permission`);
      }
    }

    if (tool.confirmation === undefined) continue;

    const view = tool.confirmation;
    if (!Number.isInteger(view.schemaVersion) || view.schemaVersion < 1) {
      e(`${at}: confirmation.schemaVersion must be a positive integer`);
    }
    if (!isObject(view.root)) {
      e(`${at}: confirmation.root is required`);
      continue;
    }
    if (view.footer !== undefined) {
      e(`${at}: footer belongs INSIDE root (root.footer), not next to it`);
    }

    const footer = view.root.footer;
    if (!Array.isArray(footer)) {
      e(`${at}: root.footer must be an array containing an actions block`);
    } else {
      const actions = footer.filter((b) => b?.type === "actions");
      if (actions.length !== 1) e(`${at}: root.footer needs exactly one actions block`);
      for (const block of actions) {
        if (!Array.isArray(block.items)) {
          e(`${at}: an actions block carries items: [{label, role}], not children`);
          continue;
        }
        const roles = block.items.map((i) => i?.role);
        if (roles.filter((r) => r === "confirm").length !== 1) {
          e(`${at}: exactly one action with role "confirm"`);
        }
        if (roles.filter((r) => r === "cancel").length !== 1) {
          e(`${at}: exactly one action with role "cancel"`);
        }
      }
    }

    // Every {{binding}} must name a real tool input.
    const properties = new Set(Object.keys(tool.inputSchema?.properties ?? {}));
    walk(view.root, (block) => {
      if (typeof block.bind === "string") {
        const name = block.bind.match(/^\{\{\s*([^}\s.]+)/)?.[1];
        if (!name) e(`${at}: bind "${block.bind}" is not a {{arg}} expression`);
        else if (!properties.has(name)) {
          e(`${at}: bind {{${name}}} does not match any inputSchema property`);
        }
      } else if (INPUT_BLOCKS.has(block.type)) {
        e(`${at}: ${block.type} block must declare a bind`);
      }
      if (block.type === "keyValue" && !Array.isArray(block.rows)) {
        e(`${at}: a confirmation keyValue uses rows: [{label, value}]`);
      }
    });
  }

  return { ok: errors.length === 0, errors };
}

export const validateManifestFile = (path) =>
  validateManifest(JSON.parse(readFileSync(path, "utf8")));
