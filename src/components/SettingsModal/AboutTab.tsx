import { useEffect, useState } from 'react';
import { tauriService } from '../../services/tauriService';

export function AboutTab() {
  const [version, setVersion] = useState('');

  useEffect(() => {
    tauriService.getAppVersion().then(setVersion);
  }, []);

  const handleLink = (e: React.MouseEvent, url: string) => {
    e.preventDefault();
    tauriService.openExternal(url);
  };

  return (
    <div className="about-content">
      <img
        src="./HoTTY_logo.png"
        alt="HoTTY Logo"
        width="64"
        height="64"
        style={{
          marginBottom: '16px',
          borderRadius: '12px',
          backgroundColor: 'var(--bg-primary)',
          padding: '4px',
        }}
      />
      <h2 style={{ margin: '0 0 8px 0' }}>HoTTY</h2>
      <p style={{ color: 'var(--text-secondary)', margin: '0 0 16px 0' }}>
        v{version}
      </p>

      <p style={{ fontWeight: 'bold', margin: '0 0 8px 0' }}>
        Katsumasa &quot;Horry&quot; Horiuchi
      </p>

      <p style={{ margin: '0 0 16px 0' }}>
        <a
          href="https://github.com/horryworks/HoTTY-Rust-Tauri"
          className="about-link"
          onClick={(e) =>
            handleLink(e, 'https://github.com/horryworks/HoTTY-Rust-Tauri')
          }
        >
          https://github.com/horryworks/HoTTY-Rust-Tauri
        </a>
      </p>

      <p style={{ color: 'var(--text-secondary)', margin: '0 0 24px 0' }}>
        SSH/Telnet/Serial Terminal Emulator
        <br />
        Built with Tauri, React, &amp; TypeScript
      </p>

      <p
        style={{
          color: 'var(--text-tertiary)',
          margin: '0 0 8px 0',
          lineHeight: '1.4',
        }}
      >
        This program is free software released under the
        <br />
        GNU General Public License v3.0 or later.
      </p>

      <p style={{ margin: '16px 0 0 0' }}>
        <a
          href="https://www.gnu.org/licenses/gpl-3.0.html"
          className="about-link"
          onClick={(e) =>
            handleLink(e, 'https://www.gnu.org/licenses/gpl-3.0.html')
          }
        >
          View GNU General Public License v3.0
        </a>
      </p>
    </div>
  );
}
