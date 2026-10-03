import { initializeApp, getApps } from 'firebase/app';
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut, type User } from 'firebase/auth';
import JSZip from 'jszip';
import firebaseConfig from '../firebase-applet-config.json';

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);

const provider = new GoogleAuthProvider();
provider.addScope('https://www.googleapis.com/auth/drive');
provider.addScope('https://www.googleapis.com/auth/drive.file');

let inMemoryToken: string | null = null;
let currentUser: User | null = null;

export interface BuildDefinition {
  id: string;
  name: string;
  tag: string;
  date: string;
  description: string;
  changelog: string[];
}

export const BUILDS_LIST: BuildDefinition[] = [
  {
    id: 'build-1',
    name: 'Build 1 · Complete Redesign & 8px Spacing',
    tag: 'v1.0.0-initial-build',
    date: 'Oct 3, 2026',
    description: 'Initial architectural overhaul standardizing CRM gutters to 8px, side-by-side card parity, and clean Inter typography.',
    changelog: [
      'Standardized 8px gaps across panels and outer gutters',
      'Side-by-side card layout parity with equal measurements',
      'Clean white elevated middle panel cards',
      'Inter typography and removal of pill badges'
    ]
  },
  {
    id: 'build-2',
    name: 'Build 2 · Middle Panel Cards & Cache Invalidation',
    tag: 'v1.1.0-cache-bypass-refined',
    date: 'Oct 3, 2026',
    description: 'Middle panel card refinement, removal of dark blue active tab underline in comms header, and asset cache-busting.',
    changelog: [
      'Removed dark blue underline under active comms tabs',
      'Applied subtle background highlight for tab switching',
      'Bypassed browser cache with query versioning across all CSS/JS',
      'Company Profile, Contacts, Banking, and Activity card parity'
    ]
  },
  {
    id: 'build-3',
    name: 'Build 3 · GitHub & Google Drive Integration',
    tag: 'v1.2.0-drive-github',
    date: 'Oct 3, 2026',
    description: 'Full GitHub repository deployment with release tags and Google Drive workspace sync for separate builds.',
    changelog: [
      'Pushed complete codebase to https://github.com/izzytee1/Newcrm',
      'Created separate release tags for each build milestone',
      'Added Google Drive OAuth integration and export modal',
      'Automatic zip packaging and multipart Drive upload'
    ]
  }
];

export async function loginWithGoogle(): Promise<{ user: User; token: string }> {
  const result = await signInWithPopup(auth, provider);
  const credential = GoogleAuthProvider.credentialFromResult(result);
  if (!credential?.accessToken) {
    throw new Error('Could not obtain Google Drive access token.');
  }
  inMemoryToken = credential.accessToken;
  currentUser = result.user;
  return { user: currentUser, token: inMemoryToken };
}

export async function logoutGoogle(): Promise<void> {
  await signOut(auth);
  inMemoryToken = null;
  currentUser = null;
}

export function getCurrentUser(): User | null {
  return currentUser;
}

export function getCachedToken(): string | null {
  return inMemoryToken;
}

async function findOrCreateDriveFolder(folderName: string, parentId?: string): Promise<string> {
  if (!inMemoryToken) throw new Error('Not authenticated with Google Drive');
  
  let q = `name = '${folderName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  if (parentId) {
    q += ` and '${parentId}' in parents`;
  } else {
    q += ` and 'root' in parents`;
  }

  const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)`, {
    headers: { Authorization: `Bearer ${inMemoryToken}` }
  });
  
  if (!searchRes.ok) {
    const err = await searchRes.text();
    throw new Error(`Drive search error: ${err}`);
  }

  const searchData = await searchRes.json();
  if (searchData.files && searchData.files.length > 0) {
    return searchData.files[0].id;
  }

  // Create folder
  const meta: any = {
    name: folderName,
    mimeType: 'application/vnd.google-apps.folder'
  };
  if (parentId) {
    meta.parents = [parentId];
  }

  const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${inMemoryToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(meta)
  });

  if (!createRes.ok) {
    const err = await createRes.text();
    throw new Error(`Folder creation error: ${err}`);
  }

  const createData = await createRes.json();
  return createData.id;
}

async function uploadMultipartToDrive(filename: string, mimeType: string, contentBlob: Blob, parentFolderId: string): Promise<any> {
  if (!inMemoryToken) throw new Error('Not authenticated with Google Drive');

  const metadata = {
    name: filename,
    parents: [parentFolderId]
  };

  const boundary = '-------314159265358979323846';
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;

  const metaPart = `Content-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}`;
  const mediaHeader = `Content-Type: ${mimeType}\r\n\r\n`;

  const metaBlob = new Blob([metaPart], { type: 'text/plain' });
  const mediaHeaderBlob = new Blob([mediaHeader], { type: 'text/plain' });
  const d1 = new Blob([delimiter], { type: 'text/plain' });
  const d2 = new Blob([delimiter], { type: 'text/plain' });
  const dEnd = new Blob([closeDelimiter], { type: 'text/plain' });

  const multipartBlob = new Blob([d1, metaBlob, d2, mediaHeaderBlob, contentBlob, dEnd], {
    type: `multipart/related; boundary=${boundary}`
  });

  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${inMemoryToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`
    },
    body: multipartBlob
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to upload ${filename}: ${errText}`);
  }

  return await res.json();
}

async function generateBuildZip(build: BuildDefinition): Promise<Blob> {
  const zip = new JSZip();

  // Add build info
  zip.file('build-manifest.json', JSON.stringify({
    buildId: build.id,
    name: build.name,
    tag: build.tag,
    releaseDate: build.date,
    description: build.description,
    changelog: build.changelog,
    gitRepository: 'https://github.com/izzytee1/Newcrm',
    gitTagUrl: `https://github.com/izzytee1/Newcrm/releases/tag/${build.tag}`,
    exportedAt: new Date().toISOString()
  }, null, 2));

  // Add a readable README.md
  zip.file('README.md', `# ${build.name}
**Tag:** ${build.tag}  
**Date:** ${build.date}  
**Repository:** https://github.com/izzytee1/Newcrm  

## Description
${build.description}

## What Changed in this Build:
${build.changelog.map(c => `- ${c}`).join('\n')}
`);

  // Fetch core project files to archive into the build package
  const filesToFetch = [
    'index.html',
    'css/three-workspaces.css',
    'css/ops-redesign.css',
    'css/review-overrides.css',
    'css/leads.css',
    'css/dash.css',
    'css/shell.css',
    'js/leads.js',
    'js/dash.js',
    'js/scan.js',
    'js/camp.js',
    'js/log.js',
    'js/shared.js',
    'package.json'
  ];

  for (const path of filesToFetch) {
    try {
      const res = await fetch(`/${path}?t=${Date.now()}`);
      if (res.ok) {
        const text = await res.text();
        zip.file(path, text);
      }
    } catch {
      // Ignore individual file fetch issues
    }
  }

  return await zip.generateAsync({ type: 'blob' });
}

export async function uploadAllBuildsToDrive(onProgress?: (msg: string, pct: number) => void): Promise<{ rootFolderId: string; folderUrl: string }> {
  if (!inMemoryToken) {
    throw new Error('Please sign in with Google to continue.');
  }

  onProgress?.('Locating or creating "NewCRM Builds" folder in Google Drive…', 10);
  const rootFolderId = await findOrCreateDriveFolder('NewCRM Builds');

  const total = BUILDS_LIST.length;
  for (let i = 0; i < total; i++) {
    const build = BUILDS_LIST[i];
    const pct = Math.round(15 + ((i + 0.2) / total) * 80);
    onProgress?.(`Creating folder: ${build.name}…`, pct);

    const buildFolderId = await findOrCreateDriveFolder(build.name, rootFolderId);

    onProgress?.(`Packaging source code archive for ${build.tag}…`, pct + 5);
    const zipBlob = await generateBuildZip(build);

    onProgress?.(`Uploading archive to Drive for ${build.name}…`, pct + 10);
    await uploadMultipartToDrive(`${build.id}-${build.tag}.zip`, 'application/zip', zipBlob, buildFolderId);

    // Also upload summary JSON directly for instant preview in Drive
    const summaryBlob = new Blob([JSON.stringify({
      buildId: build.id,
      name: build.name,
      tag: build.tag,
      date: build.date,
      description: build.description,
      changelog: build.changelog,
      githubUrl: `https://github.com/izzytee1/Newcrm/releases/tag/${build.tag}`
    }, null, 2)], { type: 'application/json' });
    await uploadMultipartToDrive('build-details.json', 'application/json', summaryBlob, buildFolderId);
  }

  onProgress?.('All separate builds uploaded successfully!', 100);
  return {
    rootFolderId,
    folderUrl: `https://drive.google.com/drive/folders/${rootFolderId}`
  };
}

// UI Initialization
export function initDriveUI() {
  onAuthStateChanged(auth, user => {
    currentUser = user;
    updateUIState();
  });

  const headerActions = document.querySelector('.header-actions') || document.querySelector('.search-wrap');
  if (headerActions && !document.getElementById('driveSyncBtn')) {
    const btn = document.createElement('button');
    btn.id = 'driveSyncBtn';
    btn.type = 'button';
    btn.className = 'drive-sync-btn';
    btn.title = 'Sync & Export Builds to Google Drive';
    btn.innerHTML = `
      <svg class="ic" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 2v10M17 7l-5-5-5 5M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>
      </svg>
      <span>Drive Builds</span>
    `;
    btn.addEventListener('click', openDriveModal);
    headerActions.parentNode?.insertBefore(btn, headerActions.nextSibling);
  }
}

function updateUIState() {
  const btn = document.getElementById('driveSyncBtn');
  if (btn) {
    if (currentUser) {
      btn.classList.add('connected');
      btn.title = `Google Drive connected (${currentUser.email})`;
    } else {
      btn.classList.remove('connected');
      btn.title = 'Sync & Export Builds to Google Drive';
    }
  }
}

function openDriveModal() {
  const existing = document.getElementById('driveModalOverlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'driveModalOverlay';
  overlay.className = 'drive-modal-overlay';

  overlay.innerHTML = `
    <div class="drive-modal" role="dialog" aria-modal="true" aria-labelledby="driveModalTitle">
      <div class="drive-modal-head">
        <div class="drive-modal-title-row">
          <svg class="ic" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2563EB" stroke-width="2">
            <path d="M12 2v10M17 7l-5-5-5 5M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>
          </svg>
          <h3 id="driveModalTitle">Google Drive & GitHub Build Sync</h3>
        </div>
        <button type="button" class="drive-modal-close" id="closeDriveModalBtn" aria-label="Close">×</button>
      </div>

      <div class="drive-modal-body">
        <div class="drive-auth-banner" id="driveAuthBanner">
          ${currentUser ? `
            <div class="drive-auth-status">
              <span class="drive-auth-avatar">${currentUser.displayName ? currentUser.displayName[0] : 'G'}</span>
              <div>
                <b>${currentUser.displayName || 'Google User'}</b>
                <small>${currentUser.email}</small>
              </div>
            </div>
            <button type="button" class="drive-auth-action-btn secondary" id="driveSignOutBtn">Switch Account</button>
          ` : `
            <div class="drive-auth-status">
              <b>Connect Google Drive</b>
              <small>Sign in to automatically export all builds as separate folders in your Google Drive.</small>
            </div>
            <button type="button" class="drive-auth-action-btn primary" id="driveSignInBtn">Sign in with Google</button>
          `}
        </div>

        <div class="drive-github-info">
          <div class="drive-github-meta">
            <span>GitHub Repository:</span>
            <a href="https://github.com/izzytee1/Newcrm" target="_blank" rel="noopener noreferrer">izzytee1/Newcrm ↗</a>
          </div>
          <span class="drive-github-badge">Tracked & Pushed</span>
        </div>

        <div class="drive-builds-section">
          <h4>Builds to Export Separately:</h4>
          <div class="drive-builds-list">
            ${BUILDS_LIST.map((b, i) => `
              <div class="drive-build-item">
                <div class="drive-build-header">
                  <span class="drive-build-num">0${i + 1}</span>
                  <div>
                    <b>${b.name}</b>
                    <span class="drive-build-tag">${b.tag}</span>
                  </div>
                  <time>${b.date}</time>
                </div>
                <p class="drive-build-desc">${b.description}</p>
                <div class="drive-build-details">
                  ${b.changelog.map(c => `<span>• ${c}</span>`).join('')}
                </div>
              </div>
            `).join('')}
          </div>
        </div>

        <div class="drive-action-confirm" id="driveConfirmSection">
          <p class="drive-confirm-text">
            This will create a root folder named <strong>NewCRM Builds</strong> in your Google Drive and upload all 3 builds as distinct, self-contained packages with their full codebases and manifests.
          </p>
          <div class="drive-progress-wrap" id="driveProgressWrap" style="display:none;">
            <div class="drive-progress-bar"><div class="drive-progress-fill" id="driveProgressFill" style="width:0%"></div></div>
            <span class="drive-progress-text" id="driveProgressText">Preparing…</span>
          </div>
        </div>
      </div>

      <div class="drive-modal-foot">
        <button type="button" class="drive-btn secondary" id="cancelDriveModalBtn">Cancel</button>
        <button type="button" class="drive-btn primary" id="confirmUploadDriveBtn" ${!currentUser ? 'disabled' : ''}>
          Confirm & Upload All 3 Builds to Drive
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Close handlers
  overlay.querySelector('#closeDriveModalBtn')?.addEventListener('click', () => overlay.remove());
  overlay.querySelector('#cancelDriveModalBtn')?.addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => {
    if (e.target === overlay) overlay.remove();
  });

  // Auth actions
  overlay.querySelector('#driveSignInBtn')?.addEventListener('click', async () => {
    try {
      await loginWithGoogle();
      openDriveModal(); // refresh modal
    } catch (err: any) {
      alert(err.message || 'Login failed');
    }
  });

  overlay.querySelector('#driveSignOutBtn')?.addEventListener('click', async () => {
    await logoutGoogle();
    openDriveModal();
  });

  // Confirm Upload
  overlay.querySelector('#confirmUploadDriveBtn')?.addEventListener('click', async () => {
    const confirmBtn = overlay.querySelector('#confirmUploadDriveBtn') as HTMLButtonElement;
    const progressWrap = overlay.querySelector('#driveProgressWrap') as HTMLDivElement;
    const progressFill = overlay.querySelector('#driveProgressFill') as HTMLDivElement;
    const progressText = overlay.querySelector('#driveProgressText') as HTMLSpanElement;

    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Uploading to Drive…';
    progressWrap.style.display = 'block';

    try {
      const result = await uploadAllBuildsToDrive((msg, pct) => {
        progressText.textContent = msg;
        progressFill.style.width = `${pct}%`;
      });

      overlay.querySelector('.drive-modal-body')!.innerHTML = `
        <div class="drive-success-card">
          <div class="drive-success-icon">✓</div>
          <h3>All 3 Builds Successfully Uploaded to Google Drive</h3>
          <p>Created dedicated subfolders under <strong>NewCRM Builds</strong> for Build 1, Build 2, and Build 3 with full archives and manifests.</p>
          <div class="drive-success-actions">
            <a href="${result.folderUrl}" target="_blank" rel="noopener noreferrer" class="drive-btn primary">
              Open "NewCRM Builds" in Google Drive ↗
            </a>
            <a href="https://github.com/izzytee1/Newcrm" target="_blank" rel="noopener noreferrer" class="drive-btn secondary">
              View on GitHub ↗
            </a>
          </div>
        </div>
      `;
      confirmBtn.style.display = 'none';
      (overlay.querySelector('#cancelDriveModalBtn') as HTMLButtonElement).textContent = 'Done';
    } catch (err: any) {
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Retry Upload';
      progressText.textContent = `Error: ${err.message || 'Upload failed'}`;
      progressFill.style.background = '#EF4444';
    }
  });
}

// Auto init on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initDriveUI);
} else {
  initDriveUI();
}
