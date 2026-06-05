import { execSync } from 'child_process';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import path from 'path';

const STATIC_DIR = path.resolve('static');
const OUTPUT_FILE = path.join(STATIC_DIR, 'licenses.json');
const ALLOW_MISSING = process.env.LICENSES_ALLOW_MISSING === '1';

console.log('Generating license reports...');

if (!existsSync(STATIC_DIR)) {
    mkdirSync(STATIC_DIR);
}

function runOrFail(label, cmd, options = {}) {
    try {
        return execSync(cmd, { encoding: 'utf8', ...options });
    } catch (e) {
        if (ALLOW_MISSING) {
            console.warn(`[licenses] Skipping ${label} — command failed and LICENSES_ALLOW_MISSING=1.`);
            return null;
        }
        console.error(`[licenses] ${label} failed: ${cmd}`);
        if (label === 'cargo-license') {
            console.error('\n  Install it with:  cargo install cargo-license\n' +
                '  (Or re-run with LICENSES_ALLOW_MISSING=1 to skip backend deps.)\n');
        }
        throw e;
    }
}

// 1. NPM licenses
console.log('- Scanning NPM dependencies...');
let npmLicenses = [];
const npmOutput = runOrFail('license-report', 'npx license-report --output=json --only=prod');
if (npmOutput) {
    const npmData = JSON.parse(npmOutput);
    npmLicenses = npmData.map((dep) => ({
        name: dep.name,
        version: dep.installedVersion,
        license: dep.licenseType,
        author: dep.author,
        link: `https://www.npmjs.com/package/${dep.name}`,
        source: 'Frontend',
    }));
}

// 2. Rust licenses
console.log('- Scanning Rust dependencies...');
let rustLicenses = [];
const rustOutput = runOrFail('cargo-license', 'cargo-license --json', { cwd: path.resolve('src-tauri') });
if (rustOutput) {
    const rustData = JSON.parse(rustOutput);
    rustLicenses = rustData.map((dep) => {
        let author = 'Various';
        if (typeof dep.authors === 'string') {
            author = dep.authors.replace(/\|/g, ', ');
        } else if (Array.isArray(dep.authors)) {
            author = dep.authors.join(', ');
        }
        return {
            name: dep.name,
            version: dep.version,
            license: dep.license || 'Unknown',
            author,
            link: dep.repository || `https://crates.io/crates/${dep.name}`,
            source: 'Backend',
        };
    });
} else {
    // Fallback: parse Cargo.toml directly for dependency names and known licenses
    console.log('  Falling back to Cargo.toml parsing...');
    try {
        const { readFileSync } = await import('fs');
        const cargoToml = readFileSync(path.resolve('src-tauri/Cargo.toml'), 'utf8');
        const knownLicenses = {
            'tauri': { license: 'Apache-2.0 OR MIT', author: 'Tauri Contributors' },
            'tauri-plugin-opener': { license: 'Apache-2.0 OR MIT', author: 'Tauri Contributors' },
            'tauri-plugin-http': { license: 'Apache-2.0 OR MIT', author: 'Tauri Contributors' },
            'tauri-plugin-store': { license: 'Apache-2.0 OR MIT', author: 'Tauri Contributors' },
            'tauri-plugin-dialog': { license: 'Apache-2.0 OR MIT', author: 'Tauri Contributors' },
            'tauri-plugin-fs': { license: 'Apache-2.0 OR MIT', author: 'Tauri Contributors' },
            'tauri-plugin-shell': { license: 'Apache-2.0 OR MIT', author: 'Tauri Contributors' },
            'tauri-plugin-process': { license: 'Apache-2.0 OR MIT', author: 'Tauri Contributors' },
            'tauri-plugin-notification': { license: 'Apache-2.0 OR MIT', author: 'Tauri Contributors' },
            'serde': { license: 'Apache-2.0 OR MIT', author: 'David Tolnay' },
            'serde_json': { license: 'Apache-2.0 OR MIT', author: 'David Tolnay' },
            'tokio': { license: 'MIT', author: 'Tokio Contributors' },
            'anyhow': { license: 'Apache-2.0 OR MIT', author: 'David Tolnay' },
            'rusqlite': { license: 'MIT', author: 'The rusqlite developers' },
            'reqwest': { license: 'Apache-2.0 OR MIT', author: 'Sean McArthur' },
            'aes-gcm': { license: 'Apache-2.0 OR MIT', author: 'RustCrypto Developers' },
            'argon2': { license: 'Apache-2.0 OR MIT', author: 'RustCrypto Developers' },
            'rand': { license: 'Apache-2.0 OR MIT', author: 'The Rand Project Developers' },
            'base64': { license: 'Apache-2.0 OR MIT', author: 'Marshall Pierce' },
            'strsim': { license: 'MIT', author: 'Danny Guo' },
            'hostname': { license: 'MIT', author: 'svartalf' },
            'log': { license: 'Apache-2.0 OR MIT', author: 'The Rust Project Developers' },
            'env_logger': { license: 'Apache-2.0 OR MIT', author: 'The Rust Project Developers' },
            'tauri-build': { license: 'Apache-2.0 OR MIT', author: 'Tauri Contributors' },
        };
        // Extract dependency names from [dependencies] section
        const depRegex = /^(\w[\w-]*)\s*=/gm;
        let match;
        const seen = new Set();
        while ((match = depRegex.exec(cargoToml)) !== null) {
            const name = match[1];
            if (seen.has(name)) continue;
            seen.add(name);
            const known = knownLicenses[name];
            rustLicenses.push({
                name,
                version: 'latest',
                license: known?.license || 'Unknown',
                author: known?.author || 'Various',
                link: `https://crates.io/crates/${name}`,
                source: 'Backend',
            });
        }
        console.log(`  Parsed ${rustLicenses.length} Rust deps from Cargo.toml`);
    } catch (e) {
        console.warn('  Could not parse Cargo.toml:', e.message);
    }
}

// 3. Combine and save
const combined = [...npmLicenses, ...rustLicenses].sort((a, b) => a.name.localeCompare(b.name));
const payload = {
    generatedAt: new Date().toISOString(),
    counts: { frontend: npmLicenses.length, backend: rustLicenses.length, total: combined.length },
    licenses: combined,
};

writeFileSync(OUTPUT_FILE, JSON.stringify(payload, null, 2));
console.log(`Generated ${combined.length} licenses (${npmLicenses.length} frontend, ${rustLicenses.length} backend) at ${OUTPUT_FILE}`);
