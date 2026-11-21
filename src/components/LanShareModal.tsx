import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Check, Copy, X } from 'lucide-react';

interface LanShareModalProps {
  onClose: () => void;
}

interface ServerInfoResponse {
  lanUrls: string[];
  primaryUrl: string;
  port?: number;
  isContainer?: boolean;
  needsHostIpHint?: boolean;
}

function buildUrlFromHostInput(raw: string, port: number): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }
  if (trimmed.includes(':')) {
    return `http://${trimmed}`;
  }
  return `http://${trimmed}:${port}`;
}

export function LanShareModal({ onClose }: LanShareModalProps) {
  const [urls, setUrls] = useState<string[]>([]);
  const [selectedUrl, setSelectedUrl] = useState<string>(window.location.origin);
  const [hostPort, setHostPort] = useState<number>(
    Number(window.location.port) || 3000,
  );
  const [needsHostIpHint, setNeedsHostIpHint] = useState(false);
  const [customHostInput, setCustomHostInput] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    fetch('/api/server-info')
      .then((res) => res.json() as Promise<ServerInfoResponse>)
      .then((data) => {
        if (!active) return;
        const resolvedPort = data.port || Number(window.location.port) || 3000;
        setHostPort(resolvedPort);
        const list = data.lanUrls.length > 0 ? data.lanUrls : [];
        setUrls(list);
        setSelectedUrl(list[0] || data.primaryUrl || window.location.origin);
        setNeedsHostIpHint(Boolean(data.needsHostIpHint));
      })
      .catch(() => {
        if (!active) return;
        setUrls([window.location.origin]);
        setSelectedUrl(window.location.origin);
      });
    return () => {
      active = false;
    };
  }, []);

  const activeShareUrl = customHostInput.trim()
    ? buildUrlFromHostInput(customHostInput, hostPort)
    : selectedUrl;

  useEffect(() => {
    if (!activeShareUrl) return;
    let active = true;
    QRCode.toDataURL(activeShareUrl, {
      width: 200,
      margin: 2,
      color: { dark: '#0f172a', light: '#f8fafc' },
    })
      .then((url) => {
        if (active) setQrDataUrl(url);
      })
      .catch(() => {
        if (active) setQrDataUrl(null);
      });
    return () => {
      active = false;
    };
  }, [activeShareUrl]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(activeShareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard API unavailable in plain HTTP on some browsers
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 px-4 py-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="lan-share-heading"
    >
      <div className="w-full max-w-lg bg-[#151e29] border border-white/10 rounded-xl p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4 pb-4 border-b border-white/10">
          <div>
            <h2 id="lan-share-heading" className="font-display text-2xl font-bold text-slate-100">
              Invite LAN Players
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              Open this address in a desktop browser on the same local network.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close LAN share dialog"
            className="p-2 text-slate-400 hover:text-slate-100 rounded-lg hover:bg-white/5 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="mt-5 space-y-5">
          {urls.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {urls.map((url) => (
                <button
                  key={url}
                  type="button"
                  onClick={() => {
                    setCustomHostInput('');
                    setSelectedUrl(url);
                  }}
                  className={`px-3 py-1.5 text-xs font-mono-tabular rounded-lg border transition-colors ${
                    !customHostInput.trim() && selectedUrl === url
                      ? 'bg-emerald-500/15 border-emerald-500 text-emerald-200'
                      : 'bg-[#0d131a] border-white/10 text-slate-300 hover:border-white/25'
                  }`}
                >
                  {url}
                </button>
              ))}
            </div>
          )}

          {needsHostIpHint && (
            <div className="p-3.5 bg-amber-950/40 border border-amber-500/30 rounded-lg space-y-2.5">
              <p className="text-xs text-amber-200">
                Running inside Docker via localhost — enter your host machine&apos;s LAN IP below
                (or set <code className="font-mono-tabular">PUBLIC_URL</code> in{' '}
                <code className="font-mono-tabular">.env</code>) to generate a shareable link.
              </p>
              <input
                type="text"
                value={customHostInput}
                onChange={(e) => setCustomHostInput(e.target.value)}
                placeholder="e.g. 192.168.1.42"
                aria-label="Host LAN IP address"
                className="w-full px-3 py-2 text-sm font-mono-tabular text-slate-100 bg-[#0d131a] border border-white/15 rounded-md placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
              />
            </div>
          )}

          <div className="flex items-center gap-2 p-2 bg-[#0d131a] border border-white/10 rounded-lg">
            <input
              type="text"
              readOnly
              value={activeShareUrl}
              aria-label="LAN server URL"
              className="flex-1 bg-transparent px-2 text-sm font-mono-tabular text-slate-100 focus:outline-none"
            />
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-950 bg-emerald-500 hover:bg-emerald-400 rounded-md transition-colors whitespace-nowrap shrink-0"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied' : 'Copy URL'}
            </button>
          </div>

          {qrDataUrl && (
            <div className="flex flex-col items-center py-3 bg-[#0d131a] border border-white/10 rounded-lg">
              <img
                src={qrDataUrl}
                alt={`QR code for ${activeShareUrl}`}
                width={160}
                height={160}
                className="w-40 h-40 rounded-lg"
              />
              <span className="mt-2 text-xs text-slate-400">
                Generated offline for local network discovery
              </span>
            </div>
          )}

          <div className="text-xs text-slate-400 space-y-1.5 pt-2 border-t border-white/10">
            <p className="font-medium text-slate-300">Connection checklist</p>
            <p>
              Ensure the host firewall permits inbound TCP traffic on port {hostPort} and that both
              devices are not isolated on a guest Wi-Fi VLAN.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
