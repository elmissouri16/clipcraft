// Publishes the app to github.com/medhachim/CapRocket_V2: the committed HEAD without website/ (the caprocket.site
// website is never published there), as one new commit on top of that repository's main. Its message lists the
// commits since the last publish; the last one published is remembered by a "Source:" line in the message.
// Usage: node scripts/publish-v2.cjs [--dry-run] [--message "title"]
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REMOTE = 'https://github.com/medhachim/CapRocket_V2.git';
const REF = 'refs/publish/v2-main'; // local copy of the remote main
const EXCLUDE = ['website'];
const dry = process.argv.includes('--dry-run');
const custom = process.argv.includes('--message') ? process.argv[process.argv.indexOf('--message') + 1] : null;
const root = path.join(__dirname, '..');
const git = (args, env = {}) => execFileSync('git', args, { cwd: root, encoding: 'utf8', env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024 }).trim();

const head = git(['rev-parse', 'HEAD']);
git(['fetch', '-q', REMOTE, `+main:${REF}`]);
const parent = git(['rev-parse', REF]);

// HEAD's tree without the excluded folders, built in a throwaway index (the working tree is not touched).
const index = path.join(os.tmpdir(), `publish-v2-${process.pid}.index`);
let tree;
try {
  git(['read-tree', 'HEAD'], { GIT_INDEX_FILE: index });
  for (const dir of EXCLUDE) git(['rm', '-r', '-q', '--cached', '--ignore-unmatch', dir], { GIT_INDEX_FILE: index });
  tree = git(['write-tree'], { GIT_INDEX_FILE: index });
} finally {
  fs.rmSync(index, { force: true });
}
if (git(['ls-tree', '-r', '--name-only', tree]).split('\n').some((f) => EXCLUDE.some((d) => f === d || f.startsWith(`${d}/`)))) {
  throw new Error('website/ is still in the tree: nothing published.');
}
if (tree === git(['rev-parse', `${parent}^{tree}`])) {
  console.log('CapRocket_V2 is already up to date.');
  process.exit(0);
}

// The commits since the last publish (or just HEAD's, the first time).
const last = /^Source: ([0-9a-f]{40})$/m.exec(git(['log', '-1', '--format=%B', parent]))?.[1];
const known = last && (() => { try { git(['merge-base', '--is-ancestor', last, head]); return true; } catch { return false; } })();
const subjects = git(['log', '--format=%s', '--no-merges', known ? `${last}..${head}` : '-1', ...(known ? [] : [head])]).split('\n').filter(Boolean);
const title = custom || (subjects.length === 1 ? subjects[0] : `${subjects[0]} (+${subjects.length - 1} more)`);
const message = [title, '', ...(subjects.length > 1 ? subjects.map((s) => `- ${s}`) : []), ...(subjects.length > 1 ? [''] : []),
  `Source: ${head}`, '', 'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>'].join('\n');

const author = { GIT_AUTHOR_NAME: git(['log', '-1', '--format=%an', head]), GIT_AUTHOR_EMAIL: git(['log', '-1', '--format=%ae', head]) };
const commit = execFileSync('git', ['commit-tree', tree, '-p', parent, '-F', '-'], {
  cwd: root, input: message, encoding: 'utf8', env: { ...process.env, ...author, GIT_COMMITTER_NAME: author.GIT_AUTHOR_NAME, GIT_COMMITTER_EMAIL: author.GIT_AUTHOR_EMAIL },
}).trim();
console.log(`${dry ? '[dry run] ' : ''}${commit.slice(0, 7)} ${title}`);
if (!dry) {
  git(['push', '-q', REMOTE, `${commit}:refs/heads/main`]); // a plain push: refused if CapRocket_V2 moved meanwhile
  git(['update-ref', REF, commit]);
  console.log('Published to CapRocket_V2.');
}
