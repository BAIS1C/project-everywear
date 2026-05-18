# EveryWear Marketing Screenshot Feature Index

Generated: 2026-05-18T23:06:40

Total UI surfaces: 40
Total rendered screenshots: 120

## 
- **Auth loading** (auth-loading) -> platform/everywear-os/src/shell/AuthGate.tsx
- **Everywear ID login** (auth-login) -> platform/everywear-os/src/shell/AuthGate.tsx
- **Everywear ID signup** (auth-signup) -> platform/everywear-os/src/shell/AuthGate.tsx
- **OTP verification** (auth-otp) -> platform/everywear-os/src/shell/AuthGate.tsx
- **Shell launcher desktop** (shell-launcher) -> platform/everywear-os/src/panels/LauncherGrid.tsx
- **Launcher folder expanded** (shell-folder-open) -> platform/everywear-os/src/panels/LauncherGrid.tsx
- **Separate applet running banner** (shell-active-applet) -> platform/everywear-os/src/shell/ShellLayout.tsx
- **Profile identity** (profile-view) -> platform/everywear-os/src/panels/ProfilePanel.tsx
- **Profile edit state** (profile-edit) -> platform/everywear-os/src/panels/ProfilePanel.tsx
- **Wallet panel** (wallet-view) -> platform/everywear-os/src/panels/WalletPanel.tsx
- **Hardware and model assessment** (hardware-view) -> platform/everywear-os/src/panels/GpuPanel.tsx
- **Settings appearance** (settings-view) -> platform/everywear-os/src/panels/SettingsPanel.tsx
- **Session logs** (logs-view) -> platform/everywear-os/src/components/LogViewerPanel.tsx
- **Bug report modal** (bug-report-modal) -> platform/everywear-os/src/components/BugReportModal.tsx
- **Vault list** (vault-list) -> applets/gener8/web/src/views/LibraryView.tsx
- **Vault detail panel** (vault-detail) -> applets/gener8/web/src/components/VaultDetailPanel.tsx
- **Vault empty/search state** (vault-empty) -> applets/gener8/web/src/views/LibraryView.tsx
- **Vault loading state** (vault-loading) -> applets/gener8/web/src/views/LibraryView.tsx
- **Applet loading skeleton** (applet-loading) -> platform/everywear-os/src/components/AppletLoadingSkeleton.tsx
- **Applet error boundary** (applet-error) -> platform/everywear-os/src/components/AppletViewRouter.tsx
- **Kasai ready state** (kasai-empty) -> applets/kasai/src/shell/KasaiCore.tsx
- **Kasai chat and tool calls** (kasai-chat-tools) -> applets/kasai/src/shell/KasaiCore.tsx
- **Kasai skill detail** (kasai-skill) -> applets/kasai/src/shell/KasaiCore.tsx
- **Runtime orchestration** (runtime-orchestration) -> crates/mait/src; platform/everywear-os/src-tauri/src/vram_scheduler.rs
- **1magen prompt workbench** (imagen-empty) -> applets/1magen/src/shell/ImagenCore.tsx
- **1magen provisioning/generating** (imagen-generating) -> applets/1magen/src/shell/ImagenCore.tsx
- **1magen result with vault save** (imagen-result) -> applets/1magen/src/shell/ImagenCore.tsx
- **3nvizen idle/offline** (threevizen-idle) -> applets/3nvizen/src/ThreevizenCore.tsx
- **3nvizen generation progress** (threevizen-generating) -> applets/3nvizen/src/ThreevizenCore.tsx
- **3nvizen completed preview** (threevizen-result) -> applets/3nvizen/src/components/VideoPreview.tsx
- **Gener8 create view** (gener8-create) -> applets/gener8/web/src/views/CreateView.tsx
- **Gener8 generation progress** (gener8-progress) -> applets/gener8/web/src/views/CreateView.tsx
- **Gener8 library** (gener8-library) -> applets/gener8/web/src/views/LibraryView.tsx
- **Gener8 settings** (gener8-settings) -> applets/gener8/web/src/views/SettingsView.tsx
- **Vid Studio runtime** (vid-studio) -> applets/vid/web/src/views/VidView.tsx
- **Vid Studio export modal** (vid-export-modal) -> applets/vid/web/src/components/VideoGeneratorModal.tsx
- **Character Studio placeholder** (character-studio) -> applets/character-studio/src/CharacterStudioPlaceholder.tsx
- **Install/model workflow** (installer-models) -> crates/model-manager/src; platform/everywear-os/src-tauri/src/setup.rs
- **File browser and project picker** (file-browser) -> applets/1magen/src; applets/gener8/web/src
- **Update workflow** (update-flow) -> platform/everywear-os/src-tauri/src/setup.rs

## Audit Notes
- Captures include deterministic synthetic data for backend-only states such as sidecar health, model downloads, bug reports, and generation progress.
- mymories, s3studio, and strands-game do not currently expose standalone local UI code in this repository; they are represented through shell/vault/ecosystem surfaces.
- 3nvizen depends on the LTX sidecar at 127.0.0.1:8787; offline and running states are captured through the deterministic marketing harness.
- Shell auth requires live Supabase/Tauri state; onboarding screens are rendered as audited deterministic states.
