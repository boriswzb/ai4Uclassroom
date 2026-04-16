'use client';

import {
  Settings,
  Sun,
  Moon,
  Monitor,
  ArrowLeft,
  Loader2,
  Download,
  FileDown,
  Package,
  Archive,
} from 'lucide-react';
import { useI18n } from '@/lib/hooks/use-i18n';
import { useTheme } from '@/lib/hooks/use-theme';
import { LanguageSwitcher } from './language-switcher';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { SettingsDialog } from './settings';
import { cn } from '@/lib/utils';
import { useStageStore } from '@/lib/store/stage';
import { useMediaGenerationStore } from '@/lib/store/media-generation';
import { useExportPPTX } from '@/lib/export/use-export-pptx';
import { useExportClassroom } from '@/lib/export/use-export-classroom';

interface HeaderProps {
  readonly currentSceneTitle: string;
}

export function Header({ currentSceneTitle }: HeaderProps) {
  const { t } = useI18n();
  const { theme, setTheme } = useTheme();
  const router = useRouter();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);

  // Export
  const { exporting: isExporting, exportPPTX, exportResourcePack } = useExportPPTX();
  const { exporting: isExportingZip, exportClassroomZip } = useExportClassroom();
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);
  const scenes = useStageStore((s) => s.scenes);
  const generatingOutlines = useStageStore((s) => s.generatingOutlines);
  const failedOutlines = useStageStore((s) => s.failedOutlines);
  const mediaTasks = useMediaGenerationStore((s) => s.tasks);

  const canExport =
    scenes.length > 0 &&
    generatingOutlines.length === 0 &&
    failedOutlines.length === 0 &&
    Object.values(mediaTasks).every((task) => task.status === 'done' || task.status === 'failed');

  const themeRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  const handleClickOutside = useCallback(
    (e: MouseEvent) => {
      if (themeOpen && themeRef.current && !themeRef.current.contains(e.target as Node)) {
        setThemeOpen(false);
      }
      if (exportMenuOpen && exportRef.current && !exportRef.current.contains(e.target as Node)) {
        setExportMenuOpen(false);
      }
    },
    [themeOpen, exportMenuOpen],
  );

  useEffect(() => {
    if (themeOpen || exportMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [themeOpen, exportMenuOpen, handleClickOutside]);

  return (
    <>
      <header className="h-14 px-4 md:px-6 flex items-center justify-between z-10 border-b border-border/60 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 gap-4">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <button
            onClick={() => router.push('/')}
            className="shrink-0 p-2 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            title={t('generation.backToHome')}
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex flex-col min-w-0">
            <span className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground mb-0.5">
              {t('stage.currentScene')}
            </span>
            <h1
              className="text-lg font-bold text-foreground tracking-tight truncate"
              suppressHydrationWarning
            >
              {currentSceneTitle || t('common.loading')}
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {/* Language Selector */}
          <LanguageSwitcher onOpen={() => setThemeOpen(false)} />

          <div className="w-[1px] h-4 bg-border/60" />

          {/* Theme Selector */}
          <div className="relative" ref={themeRef}>
            <button
              onClick={() => {
                setThemeOpen(!themeOpen);
              }}
              className="p-2 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            >
              {theme === 'light' && <Sun className="w-4 h-4" />}
              {theme === 'dark' && <Moon className="w-4 h-4" />}
              {theme === 'system' && <Monitor className="w-4 h-4" />}
            </button>
            {themeOpen && (
              <div className="absolute top-full mt-2 right-0 bg-popover border border-border rounded-lg shadow-lg overflow-hidden z-50 min-w-[140px]">
                <button
                  onClick={() => {
                    setTheme('light');
                    setThemeOpen(false);
                  }}
                  className={cn(
                    'w-full px-4 py-2 text-left text-sm hover:bg-accent transition-colors flex items-center gap-2',
                    theme === 'light' && 'bg-primary/10 text-primary',
                  )}
                >
                  <Sun className="w-4 h-4" />
                  {t('settings.themeOptions.light')}
                </button>
                <button
                  onClick={() => {
                    setTheme('dark');
                    setThemeOpen(false);
                  }}
                  className={cn(
                    'w-full px-4 py-2 text-left text-sm hover:bg-accent transition-colors flex items-center gap-2',
                    theme === 'dark' && 'bg-primary/10 text-primary',
                  )}
                >
                  <Moon className="w-4 h-4" />
                  {t('settings.themeOptions.dark')}
                </button>
                <button
                  onClick={() => {
                    setTheme('system');
                    setThemeOpen(false);
                  }}
                  className={cn(
                    'w-full px-4 py-2 text-left text-sm hover:bg-accent transition-colors flex items-center gap-2',
                    theme === 'system' && 'bg-primary/10 text-primary',
                  )}
                >
                  <Monitor className="w-4 h-4" />
                  {t('settings.themeOptions.system')}
                </button>
              </div>
            )}
          </div>

          <div className="w-[1px] h-4 bg-border/60" />

          {/* Settings Button */}
          <button
            onClick={() => setSettingsOpen(true)}
            className="p-2 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <Settings className="w-4 h-4" />
          </button>

          <div className="w-[1px] h-4 bg-border/60" />

          {/* Export Dropdown */}
          <div className="relative" ref={exportRef}>
            <button
              onClick={() => {
                if (canExport && !isExporting && !isExportingZip) setExportMenuOpen(!exportMenuOpen);
              }}
              disabled={!canExport || isExporting || isExportingZip}
              title={
                canExport
                  ? isExporting || isExportingZip
                    ? t('export.exporting')
                    : t('export.pptx')
                  : t('share.notReady')
              }
              className={cn(
                'shrink-0 p-2 rounded-lg transition-colors',
                canExport && !isExporting && !isExportingZip
                  ? 'text-muted-foreground hover:bg-accent hover:text-foreground'
                  : 'text-muted-foreground/40 cursor-not-allowed',
              )}
            >
              {isExporting || isExportingZip ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Download className="w-4 h-4" />
              )}
            </button>
            {exportMenuOpen && (
              <div className="absolute top-full mt-2 right-0 bg-popover border border-border rounded-lg shadow-lg overflow-hidden z-50 min-w-[200px]">
                <button
                  onClick={() => {
                    setExportMenuOpen(false);
                    exportPPTX();
                  }}
                  className="w-full px-4 py-2.5 text-left text-sm hover:bg-accent transition-colors flex items-center gap-2.5"
                >
                  <FileDown className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span>{t('export.pptx')}</span>
                </button>
                <button
                  onClick={() => {
                    setExportMenuOpen(false);
                    exportResourcePack();
                  }}
                  className="w-full px-4 py-2.5 text-left text-sm hover:bg-accent transition-colors flex items-center gap-2.5"
                >
                  <Package className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div>
                    <div>{t('export.resourcePack')}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {t('export.resourcePackDesc')}
                    </div>
                  </div>
                </button>
                <button
                  onClick={() => {
                    setExportMenuOpen(false);
                    exportClassroomZip();
                  }}
                  disabled={isExportingZip}
                  className="w-full px-4 py-2.5 text-left text-sm hover:bg-accent transition-colors flex items-center gap-2.5"
                >
                  <Archive className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div>
                    <div>{t('export.classroomZip')}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {t('export.classroomZipDesc')}
                    </div>
                  </div>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </>
  );
}
