'use client'

import { useState } from 'react'
import styles from './topbar.module.css'

interface TopbarProps {
  title: string
  breadcrumb?: { label: string; href?: string }[]
}

export function Topbar({ title, breadcrumb }: TopbarProps) {
  const [notifications] = useState(3)

  return (
    <header className={styles.topbar}>
      <div className={styles.left}>
        {breadcrumb && breadcrumb.length > 0 && (
          <nav className={styles.breadcrumb}>
            {breadcrumb.map((crumb, i) => (
              <span key={i}>
                {crumb.href ? <a href={crumb.href} className={styles.crumbLink}>{crumb.label}</a> : <span className={styles.crumbCurrent}>{crumb.label}</span>}
                {i < breadcrumb.length - 1 && <span className={styles.sep}> / </span>}
              </span>
            ))}
          </nav>
        )}
        <h1 className={styles.title}>{title}</h1>
      </div>

      <div className={styles.right}>
        {/* Notification */}
        <button className={styles.iconBtn} title="通知">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
          </svg>
          {notifications > 0 && <span className={styles.badge}>{notifications}</span>}
        </button>

        {/* Help */}
        <button className={styles.iconBtn} title="帮助">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/>
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
            <line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
        </button>

        {/* Fullscreen */}
        <button className={styles.iconBtn} title="全屏">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
          </svg>
        </button>
      </div>
    </header>
  )
}
