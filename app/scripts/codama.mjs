// Regenerates src/generated from the Anchor IDL. Run after `anchor build`.
import { readFileSync } from 'node:fs';
import { createFromRoot } from 'codama';
import { rootNodeFromAnchor } from '@codama/nodes-from-anchor';
import { renderVisitor } from '@codama/renderers-js';

const idl = JSON.parse(readFileSync(new URL('../../target/idl/degenwild.json', import.meta.url)));
const codama = createFromRoot(rootNodeFromAnchor(idl));
await codama.accept(renderVisitor(new URL('..', import.meta.url).pathname, { generatedFolder: 'src/generated', syncPackageJson: false, deleteFolderBeforeRendering: true, formatCode: true }));

// Error messages for the UI (the generated helper drops them in production bundles).
import { writeFileSync } from 'node:fs';
writeFileSync(
  new URL('../src/program-errors.json', import.meta.url),
  JSON.stringify(Object.fromEntries(idl.errors.map((e) => [e.code, e.msg])), null, 2) + '\n',
);
