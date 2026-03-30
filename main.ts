import { App, Plugin, PluginSettingTab, Setting, Notice, TFile, requestUrl, debounce } from 'obsidian';

// ─── Settings ───────────────────────────────────────────────────────────────

interface ObvecSettings {
  apiKey: string;
  serverUrl: string;
  autoSync: boolean;
  syncIntervalMinutes: number;
  excludePatterns: string; // newline-separated regex patterns
}

const DEFAULT_SETTINGS: ObvecSettings = {
  apiKey: '',
  serverUrl: 'https://rag.10xboost.org',
  autoSync: true,
  syncIntervalMinutes: 15,
  excludePatterns: '',
};

// ─── Types ──────────────────────────────────────────────────────────────────

interface SyncFile {
  file_path: string;
  content: string;
  content_hash: string;
  action: 'upsert' | 'delete';
}

interface SyncResponse {
  synced: number;
  skipped: number;
  deleted: number;
  errors: string[];
  quota: { used: number; limit: number };
}

interface UserStats {
  plan: string;
  vault_file_count: number;
  vault_chunk_count: number;
  last_sync_at: string | null;
}

async function hashContent(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ─── Plugin ─────────────────────────────────────────────────────────────────

export default class ObvecPlugin extends Plugin {
  settings: ObvecSettings = DEFAULT_SETTINGS;
  statusBarEl: HTMLElement | null = null;
  syncInterval: number | null = null;
  isSyncing = false;
  lastSyncedHashes: Map<string, string> = new Map();

  // Server-side stats (fetched periodically)
  serverStats: UserStats | null = null;

  async onload() {
    await this.loadSettings();

    // Status bar
    this.statusBarEl = this.addStatusBarItem();
    this.statusBarEl.addClass('obvec-status');
    this.updateStatusBar('idle');

    // Settings tab
    this.addSettingTab(new ObvecSettingTab(this.app, this));

    // Commands
    this.addCommand({
      id: 'sync-now',
      name: 'Sync vault now',
      callback: () => { void this.syncAll(); },
    });

    this.addCommand({
      id: 'sync-status',
      name: 'View sync status',
      callback: () => { void this.showSyncStatus(); },
    });

    // File event listeners for real-time sync
    this.registerEvent(this.app.vault.on('modify', debounce((file: TFile) => {
      if (this.settings.autoSync && this.settings.apiKey) {
        void this.syncFile(file, 'upsert');
      }
    }, 5000, true)));

    this.registerEvent(this.app.vault.on('create', (file) => {
      if (file instanceof TFile && this.settings.autoSync && this.settings.apiKey) {
        void this.syncFile(file, 'upsert');
      }
    }));

    this.registerEvent(this.app.vault.on('delete', (file) => {
      if (file instanceof TFile && file.extension === 'md' && this.settings.autoSync && this.settings.apiKey) {
        void this.syncDeletedFile(file.path);
      }
    }));

    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      if (file instanceof TFile && file.extension === 'md' && this.settings.autoSync && this.settings.apiKey) {
        void this.syncDeletedFile(oldPath);
        void this.syncFile(file, 'upsert');
      }
    }));

    // Start periodic sync
    this.startPeriodicSync();

    // Fetch server stats on load
    if (this.settings.apiKey) {
      void this.fetchServerStats();
      // Initial sync (delayed 10s)
      if (this.settings.autoSync) {
        window.setTimeout(() => { void this.syncAll(); }, 10000);
      }
    }
  }

  onunload() {
    this.stopPeriodicSync();
  }

  // ─── Settings ──────────────────────────────────────────────

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.stopPeriodicSync();
    this.startPeriodicSync();
  }

  // ─── Periodic Sync ────────────────────────────────────────

  startPeriodicSync() {
    if (!this.settings.autoSync || !this.settings.apiKey) return;

    const ms = this.settings.syncIntervalMinutes * 60 * 1000;
    this.syncInterval = window.setInterval(() => {
      void this.syncAll();
    }, ms);
    this.registerInterval(this.syncInterval);
  }

  stopPeriodicSync() {
    if (this.syncInterval !== null) {
      window.clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }

  // ─── Status Bar ──────────────────────────────────────────

  updateStatusBar(status: 'idle' | 'syncing' | 'error', detail?: string) {
    if (!this.statusBarEl) return;

    const indexed = this.serverStats?.vault_file_count ?? this.lastSyncedHashes.size;

    switch (status) {
      case 'idle':
        this.statusBarEl.setText(`Obvec: ${indexed} indexed`);
        break;
      case 'syncing':
        this.statusBarEl.setText(`Obvec: syncing ${detail || ''}...`);
        break;
      case 'error':
        this.statusBarEl.setText(`Obvec: error`);
        break;
    }
  }

  // ─── Server Stats ────────────────────────────────────────

  async fetchServerStats(): Promise<UserStats | null> {
    if (!this.settings.apiKey) return null;

    try {
      const response = await requestUrl({
        url: `${this.settings.serverUrl}/api/user/stats`,
        method: 'GET',
        headers: { 'Authorization': `Bearer ${this.settings.apiKey}` },
      });
      if (response.status === 200) {
        this.serverStats = response.json as UserStats;
        this.updateStatusBar('idle');
        return this.serverStats;
      }
      return null;
    } catch (e) {
      console.warn('Obvec: stats fetch failed', e);
      return null;
    }
  }

  // ─── Exclude Filter ──────────────────────────────────────

  shouldExclude(filePath: string): boolean {
    if (!this.settings.excludePatterns.trim()) return false;

    const patterns = this.settings.excludePatterns
      .split('\n')
      .map(p => p.trim())
      .filter(Boolean);

    for (const pattern of patterns) {
      try {
        if (new RegExp(pattern).test(filePath)) return true;
      } catch {
        // Invalid regex, skip
      }
    }
    return false;
  }

  // ─── Sync Logic ─────────────────────────────────────────

  async syncFile(file: TFile, action: 'upsert' | 'delete') {
    if (file.extension !== 'md') return;
    if (this.isSyncing) return; // Skip individual syncs during full sync
    if (this.shouldExclude(file.path)) return;
    if (!this.settings.apiKey) return;

    try {
      const content = await this.app.vault.read(file);
      const hash = await hashContent(content);

      if (this.lastSyncedHashes.get(file.path) === hash) return;

      await this.sendSyncBatch([{
        file_path: file.path,
        content,
        content_hash: hash,
        action,
      }]);

      this.lastSyncedHashes.set(file.path, hash);
      // Refresh stats after single-file sync
      await this.fetchServerStats();
    } catch (e) {
      console.error('Obvec sync error:', e);
    }
  }

  async syncDeletedFile(filePath: string) {
    if (!this.settings.apiKey || this.isSyncing) return;
    try {
      await this.sendSyncBatch([{
        file_path: filePath,
        content: '',
        content_hash: '',
        action: 'delete',
      }]);
      this.lastSyncedHashes.delete(filePath);
      await this.fetchServerStats();
    } catch (e) {
      console.error('Obvec delete sync error:', e);
    }
  }

  async syncAll() {
    if (this.isSyncing) return;
    if (!this.settings.apiKey) {
      new Notice('Obvec: please set your API key in settings');
      return;
    }

    this.isSyncing = true;
    const startTime = Date.now();

    try {
      // Phase 1: Scan vault and compute hashes
      const mdFiles = this.app.vault.getMarkdownFiles();
      const totalFiles = mdFiles.length;
      this.updateStatusBar('syncing', `scanning 0/${totalFiles}`);

      const filesToSync: SyncFile[] = [];
      let scanned = 0;

      for (const file of mdFiles) {
        if (this.shouldExclude(file.path)) {
          scanned++;
          continue;
        }

        const content = await this.app.vault.read(file);
        const hash = await hashContent(content);

        if (this.lastSyncedHashes.get(file.path) !== hash) {
          filesToSync.push({
            file_path: file.path,
            content,
            content_hash: hash,
            action: 'upsert',
          });
        }

        scanned++;
        // Update progress every 100 files to avoid UI lag
        if (scanned % 100 === 0) {
          this.updateStatusBar('syncing', `scanning ${scanned}/${totalFiles}`);
        }
      }

      if (filesToSync.length === 0) {
        await this.fetchServerStats();
        this.updateStatusBar('idle');
        this.isSyncing = false;
        new Notice(`Obvec: all ${totalFiles} files up to date`);
        return;
      }

      // Phase 2: Upload in batches
      const estimatedMinutes = Math.ceil(filesToSync.length / 3 * 3 / 60);
      console.debug(`Obvec: starting upload of ${filesToSync.length} files (~${estimatedMinutes} min)`);
      new Notice(`Obvec: uploading ${filesToSync.length} files (~${estimatedMinutes} min)`);
      const batchSize = 3; // Small batches to avoid ERR_INSUFFICIENT_RESOURCES
      const batchDelay = 3000; // 3s between batches for embedding processing
      let totalSynced = 0;
      let totalSkipped = 0;
      const totalErrors: string[] = [];
      let uploaded = 0;
      let rateLimited = false;

      for (let i = 0; i < filesToSync.length; i += batchSize) {
        if (rateLimited) break; // Stop if rate limited

        const batch = filesToSync.slice(i, i + batchSize);
        uploaded += batch.length;
        this.updateStatusBar('syncing', `${uploaded}/${filesToSync.length} uploading`);

        // Retry up to 2 times on failure (but not on 401 rate limit)
        let success = false;
        for (let attempt = 0; attempt < 3 && !success; attempt++) {
          try {
            if (attempt > 0) {
              // Exponential backoff: 5s, 10s
              const backoff = 5000 * attempt;
              await new Promise(r => setTimeout(r, backoff));
              this.updateStatusBar('syncing', `${uploaded}/${filesToSync.length} retry ${attempt}`);
            }
            const result = await this.sendSyncBatch(batch);
            totalSynced += result.synced;
            totalSkipped += result.skipped;
            totalErrors.push(...result.errors);

            for (const file of batch) {
              if (!result.errors.some(e => e.includes(file.file_path))) {
                this.lastSyncedHashes.set(file.file_path, file.content_hash);
              }
            }
            success = true;
          } catch (e: unknown) {
            const errMsg = e instanceof Error ? e.message : String(e);
            const status = errMsg.match(/\d+/)?.[0];
            if (status === '429' || status === '401') {
              // Rate limited or auth failed — stop retrying, don't burn more quota
              console.error(`Obvec: ${status === '429' ? 'rate limited' : 'auth failed'} at batch ${i / batchSize + 1}, stopping sync`);
              totalErrors.push(`${status === '429' ? 'Rate limited' : 'Auth failed'} after ${uploaded} files — will resume next sync`);
              rateLimited = true;
              break;
            }
            console.error(`Obvec batch ${i / batchSize + 1} attempt ${attempt + 1} failed:`, errMsg);
            if (status === '500' && attempt < 2) {
              // Server error — wait longer before retry
              await new Promise(r => setTimeout(r, 10000));
            }
            if (attempt === 2) {
              totalErrors.push(`Batch ${i / batchSize + 1}: ${errMsg}`);
            }
          }
        }

        // Delay between batches to avoid overwhelming server + Electron connections
        if (i + batchSize < filesToSync.length && !rateLimited) {
          await new Promise(r => setTimeout(r, batchDelay));
        }
      }

      // Phase 3: Refresh stats and report
      await this.fetchServerStats();
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const indexed = this.serverStats?.vault_file_count ?? '?';

      if (totalErrors.length > 0) {
        new Notice(`Obvec: ${totalSynced} synced, ${totalErrors.length} errors (${elapsed}s)\nTotal indexed: ${indexed}`);
        console.error('Obvec sync errors:', totalErrors);
      } else {
        new Notice(`Obvec: ${totalSynced} synced, ${totalSkipped} unchanged (${elapsed}s)\nTotal indexed: ${indexed}`);
      }

      this.updateStatusBar('idle');
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error('Obvec sync error:', errMsg);
      this.updateStatusBar('error');
      new Notice(`Obvec sync failed: ${errMsg}`);
    } finally {
      this.isSyncing = false;
    }
  }

  async sendSyncBatch(files: SyncFile[]): Promise<SyncResponse> {
    const url = `${this.settings.serverUrl}/api/sync/batch`;

    const response = await requestUrl({
      url,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.settings.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ files }),
    });

    if (response.status !== 200) {
      throw new Error(`Request failed, status ${response.status}`);
    }

    return response.json as SyncResponse;
  }

  async showSyncStatus() {
    if (!this.settings.apiKey) {
      new Notice('Obvec: please set your API key in settings');
      return;
    }

    try {
      const stats = await this.fetchServerStats();
      if (!stats) {
        new Notice('Obvec: failed to fetch status');
        return;
      }

      const localFiles = this.app.vault.getMarkdownFiles().length;
      const limitMB = stats.plan === 'pro' ? '1GB' : '10MB';

      new Notice(
        `Obvec status\n` +
        `───────────\n` +
        `Plan: ${stats.plan.toUpperCase()}\n` +
        `Indexed: ${stats.vault_file_count} / ${localFiles} files\n` +
        `Chunks: ${stats.vault_chunk_count}\n` +
        `Quota: ${limitMB}\n` +
        `Last sync: ${stats.last_sync_at ? new Date(stats.last_sync_at + 'Z').toLocaleString() : 'Never'}`,
        10000
      );
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e);
      new Notice(`Obvec: failed to get status - ${errMsg}`);
    }
  }
}

// ─── Settings Tab ──────────────────────────────────────────────────────────

class ObvecSettingTab extends PluginSettingTab {
  plugin: ObvecPlugin;
  statsEl: HTMLElement | null = null;

  constructor(app: App, plugin: ObvecPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName('Obvec — AI search for your second brain').setHeading();

    // ─── Live Stats Panel ───
    const statsPanel = containerEl.createDiv({ cls: 'obvec-stats-panel' });
    this.statsEl = statsPanel;
    this.refreshStatsPanel(statsPanel);

    new Setting(containerEl)
      .setName('API key')
      .setDesc('Get your key from the dashboard at obsidian.10xboost.org')
      .addText(text => text
        .setPlaceholder('Paste your API key here')
        .setValue(this.plugin.settings.apiKey)
        .onChange(async (value) => {
          this.plugin.settings.apiKey = value.replace(/\s/g, '');
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Server URL')
      .setDesc('Obvec server URL')
      .addText(text => text
        .setValue(this.plugin.settings.serverUrl)
        .onChange(async (value) => {
          this.plugin.settings.serverUrl = value.trim().replace(/\/$/, '');
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Auto sync')
      .setDesc('Automatically sync when files are modified')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.autoSync)
        .onChange(async (value) => {
          this.plugin.settings.autoSync = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Sync interval')
      .setDesc('Full vault sync interval in minutes')
      .addDropdown(dropdown => dropdown
        .addOption('5', '5 Minutes')
        .addOption('15', '15 Minutes')
        .addOption('30', '30 Minutes')
        .addOption('60', '1 Hour')
        .setValue(String(this.plugin.settings.syncIntervalMinutes))
        .onChange(async (value) => {
          this.plugin.settings.syncIntervalMinutes = parseInt(value);
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Exclude patterns')
      .setDesc('Regex patterns to exclude files (one per line)')
      .addTextArea(text => text
        .setPlaceholder('')
        .setValue(this.plugin.settings.excludePatterns)
        .onChange(async (value) => {
          this.plugin.settings.excludePatterns = value;
          await this.plugin.saveSettings();
        }));

    // Action buttons
    new Setting(containerEl)
      .setName('Sync now')
      .setDesc('Manually trigger a full vault sync')
      .addButton(button => button
        .setButtonText('Sync now')
        .setCta()
        .onClick(() => {
          void this.plugin.syncAll();
          // Refresh stats panel after sync starts
          window.setTimeout(() => this.refreshStatsPanel(statsPanel), 3000);
        }));

    new Setting(containerEl)
      .setName('Refresh stats')
      .setDesc('Fetch latest index count from server')
      .addButton(button => button
        .setButtonText('Refresh')
        .onClick(async () => {
          await this.plugin.fetchServerStats();
          this.refreshStatsPanel(statsPanel);
          new Notice('Obvec: stats refreshed');
        }));
  }

  refreshStatsPanel(panel: HTMLElement) {
    panel.empty();

    const stats = this.plugin.serverStats;
    const localFiles = this.plugin.app.vault.getMarkdownFiles().length;

    if (!this.plugin.settings.apiKey) {
      panel.createEl('p', { text: 'Enter your API key above to get started.', cls: 'setting-item-description' });
      return;
    }

    if (!stats) {
      panel.createEl('p', { text: 'Loading stats...', cls: 'setting-item-description' });
      // Fetch in background
      void this.plugin.fetchServerStats().then(() => this.refreshStatsPanel(panel));
      return;
    }

    const grid = panel.createDiv({ cls: 'obvec-stats-grid' });

    const makeCard = (label: string, value: string) => {
      const card = grid.createDiv({ cls: 'obvec-stat-card' });
      card.createEl('div', { text: value, cls: 'obvec-stat-value' });
      card.createEl('div', { text: label, cls: 'obvec-stat-label setting-item-description' });
    };

    makeCard('Indexed', `${stats.vault_file_count} / ${localFiles}`);
    makeCard('Chunks', `${stats.vault_chunk_count}`);
    makeCard('Plan', stats.plan.toUpperCase());

    // Estimated sync time for remaining files
    const remaining = localFiles - stats.vault_file_count;
    if (remaining > 0) {
      const estMinutes = Math.ceil(remaining / 3 * 3 / 60);
      panel.createEl('p', {
        text: `${remaining} files to sync (~${estMinutes} min)`,
        cls: 'obvec-sync-estimate setting-item-description',
      });
    }

    if (stats.last_sync_at) {
      panel.createEl('p', {
        text: `Last sync: ${new Date(stats.last_sync_at + 'Z').toLocaleString()}`,
        cls: 'obvec-last-sync setting-item-description',
      });
    }
  }
}
