import { Button } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { ArrowRight, Info, Laptop, Plus, ShieldCheck } from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';

import type { RemoteDeviceSummary, RemoteDevicesResponse, RemotePairingResponse, RemoteProject } from '../../shared/devices';
import { useTranslation } from '../i18n';
import { deviceStyles as styles } from './devices/device-styles';
import { RevokeDialog } from './devices/RevokeDialog';

type PairState = 'idle' | 'loading' | 'preview' | 'invalid' | 'expired' | 'network' | 'unconfirmed' | 'approved' | 'denied';

class RequestError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...init });
  if (!response.ok) throw new RequestError(response.status, `HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

function normalizeCode(value: string) {
  const plain = value.toUpperCase().replace(/[\s-]/g, '');
  return plain.length === 12 ? `${plain.slice(0, 4)}-${plain.slice(4, 8)}-${plain.slice(8)}` : value.trim().toUpperCase();
}

function postBody(body: object): RequestInit {
  return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

function DevicesList() {
  const { t, i18n } = useTranslation();
  const [tab, setTab] = useState<'list' | 'guide'>('list');
  const [data, setData] = useState<RemoteDevicesResponse | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [pending, setPending] = useState<RemoteDeviceSummary | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const next = await request<RemoteDevicesResponse>('/api/remote/auth/devices');
      if (!Array.isArray(next.devices) || !Array.isArray(next.projects)) throw new Error('Invalid devices response');
      setData(next);
      setLoadError(false);
    } catch (error) {
      setLoadError(true);
      throw error;
    }
  }, []);

  useEffect(() => { void reload().catch(() => undefined); }, [reload]);

  const projectNames = (ids: string[], projects: RemoteProject[]) =>
    ids.map((id) => projects.find((project) => project.id === id)?.name ?? id);

  const revoke = async () => {
    if (!pending || revoking) return;
    setRevoking(true);
    setRevokeError(null);
    try {
      const result = await request<{ revoked: boolean }>('/api/remote/auth/revoke', postBody({ id: pending.id }));
      if (!result.revoked) throw new Error('Invalid revoke response');
      setPending(null);
      await reload();
    } catch (error) {
      if (pending) setRevokeError(t('devices.revokeFailed', { error: (error as Error).message }));
    } finally {
      setRevoking(false);
    }
  };

  const origin = data?.origin ?? location.origin;
  return (
    <section {...stylex.props(styles.page)}>
      <div {...stylex.props(styles.heading)}>
        <h1 {...stylex.props(styles.title)}>{t('devices.title')}</h1>
        <span {...stylex.props(styles.subtitle)}>{t('devices.subtitle')}</span>
      </div>
      <div {...stylex.props(styles.toolbar)}>
        <div role="tablist" aria-label={t('devices.title')} {...stylex.props(styles.tabs)}>
          <button aria-selected={tab === 'list'} role="tab" type="button" {...stylex.props(styles.tab, tab === 'list' && styles.tabActive)} onClick={() => setTab('list')}>{t('devices.authorized')}</button>
          <button aria-selected={tab === 'guide'} role="tab" type="button" {...stylex.props(styles.tab, tab === 'guide' && styles.tabActive)} onClick={() => setTab('guide')}>{t('devices.guide')}</button>
        </div>
        <a href="/connect" {...stylex.props(styles.primaryLink)}><Plus aria-hidden="true" size={14} />{t('devices.connect')}</a>
      </div>

      {tab === 'list' ? (
        <div role="tabpanel">
          {loadError && <div role="alert" {...stylex.props(styles.status, styles.error)}>{t('devices.loadFailed')}<Button className={stylex.props(styles.button).className} size="small" onClick={() => void reload().catch(() => undefined)}>{t('devices.retry')}</Button></div>}
          {!loadError && data === null && <p role="status" {...stylex.props(styles.status)}>{t('devices.loading')}</p>}
          {!loadError && data?.devices.length === 0 && (
            <div {...stylex.props(styles.panel, styles.empty)}>
              <Laptop aria-hidden="true" size={28} {...stylex.props(styles.icon)} />
              <h2 {...stylex.props(styles.emptyTitle)}>{t('devices.emptyTitle')}</h2>
              <p {...stylex.props(styles.emptyCopy)}>{t('devices.emptyCopy')}</p>
              <a href="/connect" {...stylex.props(styles.primaryLink)}>{t('devices.connect')}</a>
            </div>
          )}
          {!loadError && data && data.devices.length > 0 && (
            <div {...stylex.props(styles.panel)}>
              <ul {...stylex.props(styles.list)}>
                {data.devices.map((device) => (
                  <li key={device.id} {...stylex.props(styles.row)}>
                    <Laptop aria-hidden="true" size={16} {...stylex.props(styles.icon)} />
                    <div {...stylex.props(styles.rowContent)}>
                      <strong {...stylex.props(styles.rowTitle)}>{device.name}</strong>
                      <p {...stylex.props(styles.rowMeta)}>{t('devices.localCli')} · {projectNames(device.projects, data.projects).join(i18n.language === 'zh' ? '、' : ', ')}</p>
                      <p {...stylex.props(styles.rowMeta)}>{t('devices.expires', { date: new Date(device.expiresAt).toLocaleDateString(i18n.language) })}</p>
                    </div>
                    <span {...stylex.props(styles.rowState)}>{t('devices.authorizedState')}</span>
                    <Button className={stylex.props(styles.button).className} size="small" onClick={() => { setRevokeError(null); setPending(device); }}>{t('devices.revoke')}</Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p {...stylex.props(styles.note)}><Info aria-hidden="true" size={13} />{t('devices.revokeNote')}</p>
          <div {...stylex.props(styles.guideLink)}><span>{t('devices.guidePrompt')}</span><button type="button" {...stylex.props(styles.textButton)} onClick={() => setTab('guide')}>{t('devices.viewGuide')} <ArrowRight aria-hidden="true" size={12} /></button></div>
        </div>
      ) : (
        <div role="tabpanel" {...stylex.props(styles.guide)}>
          <h2 {...stylex.props(styles.sectionTitle)}>{t('devices.guideTitle')}</h2>
          <p {...stylex.props(styles.copy)}>{t('devices.guideIntro')}</p>
          <ol {...stylex.props(styles.steps)}>
            <li>{t('devices.guideStep1')}<code {...stylex.props(styles.code)}>{`anjian login ${origin}`}</code></li>
            <li>{t('devices.guideStep2')}<code {...stylex.props(styles.code)}>{'anjian link'}</code></li>
            <li>{t('devices.guideStep3')}<code {...stylex.props(styles.code)}>{'anjian push --artifact document/plan'}</code></li>
          </ol>
          <p {...stylex.props(styles.note)}><Info aria-hidden="true" size={13} />{t('devices.guideBrowser')}</p>
          <a href="/connect" {...stylex.props(styles.primaryLink)}>{t('devices.connect')}</a>
        </div>
      )}

      {pending && <RevokeDialog
        name={pending.name}
        projects={projectNames(pending.projects, data?.projects ?? [])}
        busy={revoking}
        error={revokeError}
        onCancel={() => { if (!revoking) setPending(null); }}
        onConfirm={() => void revoke()}
      />}
    </section>
  );
}

function ConnectDevice() {
  const { t, i18n } = useTranslation();
  const initial = new URLSearchParams(location.search).get('code') ?? '';
  const [input, setInput] = useState(initial);
  const [state, setState] = useState<PairState>('idle');
  const [pairing, setPairing] = useState<RemotePairingResponse | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [deciding, setDeciding] = useState(false);
  const requestId = useRef(0);
  const decidingRef = useRef(false);

  const preview = useCallback(async (raw: string) => {
    const id = ++requestId.current;
    const code = normalizeCode(raw);
    setInput(code);
    setPairing(null);
    setChosen(new Set());
    setError(null);
    if (!/^[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){2}$/.test(code)) {
      setState('invalid');
      return;
    }
    setState('loading');
    try {
      const result = await request<RemotePairingResponse>(`/api/remote/auth/pairing?code=${encodeURIComponent(code)}`);
      if (id !== requestId.current) return;
      if (!result.pairing || !Array.isArray(result.projects)) throw new Error('Invalid pairing response');
      setPairing(result);
      setState('preview');
      const url = new URL(location.href);
      url.searchParams.set('code', code);
      history.replaceState(null, '', url);
    } catch (cause) {
      if (id !== requestId.current) return;
      setState(cause instanceof RequestError && cause.status === 410 ? 'expired' : 'network');
      setError((cause as Error).message);
    }
  }, []);

  useEffect(() => {
    if (initial) void preview(initial);
    return () => { requestId.current++; };
  }, []);
  useEffect(() => {
    if (state !== 'preview' || !pairing) return;
    const timer = setInterval(() => {
      if (Date.now() >= pairing.pairing.expiresAt) setState('expired');
    }, 1000);
    return () => clearInterval(timer);
  }, [state, pairing]);

  const decide = async (decision: 'approve' | 'deny') => {
    if (!pairing || state !== 'preview' || decidingRef.current || (decision === 'approve' && chosen.size === 0)) return;
    decidingRef.current = true;
    setDeciding(true);
    setState('loading');
    setError(null);
    try {
      const result = await request<{ approved?: boolean; denied?: boolean }>(`/api/remote/auth/${decision}`, postBody({
        code: pairing.pairing.code,
        ...(decision === 'approve' ? { projects: [...chosen] } : {}),
      }));
      if (result[decision === 'approve' ? 'approved' : 'denied'] !== true) throw new Error('Invalid pairing response');
      setState(decision === 'approve' ? 'approved' : 'denied');
    } catch (cause) {
      if (cause instanceof RequestError && cause.status === 410) {
        setState('expired');
      } else {
        // A response can be lost after the decision is committed. Re-read the
        // pending request before enabling either action again.
        try {
          await request<RemotePairingResponse>(`/api/remote/auth/pairing?code=${encodeURIComponent(pairing.pairing.code)}`);
          setState('preview');
          setError(t('devices.actionFailed', { error: (cause as Error).message }));
        } catch {
          setState('unconfirmed');
        }
      }
    } finally {
      decidingRef.current = false;
      setDeciding(false);
    }
  };

  const submit = (event: FormEvent) => { event.preventDefault(); void preview(input); };
  const toggleProject = (id: string) => setChosen((previous) => {
    const next = new Set(previous);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  return (
    <section {...stylex.props(styles.page)}>
      <div {...stylex.props(styles.heading)}>
        <h1 {...stylex.props(styles.title)}>{t('devices.connectTitle')}</h1>
        <span {...stylex.props(styles.subtitle)}>{t('devices.connectSubtitle')}</span>
      </div>
      <div {...stylex.props(styles.form)}>
        <p {...stylex.props(styles.copy)}>{t('devices.connectIntro')}</p>
        <form onSubmit={submit}>
          <label htmlFor="pair-code" {...stylex.props(styles.label)}>{t('devices.codeLabel')}</label>
          <input id="pair-code" autoComplete="off" disabled={deciding} maxLength={24} spellCheck={false} type="text" value={input} {...stylex.props(styles.input)} onChange={(event) => {
            requestId.current++;
            setInput(event.target.value);
            setPairing(null);
            setChosen(new Set());
            setError(null);
            setState('idle');
            const url = new URL(location.href);
            url.searchParams.delete('code');
            history.replaceState(null, '', url);
          }} />
          <div {...stylex.props(styles.actions)}>
            <Button className={stylex.props(styles.button).className} disabled={!input.trim() || state === 'loading'} htmlType="submit">{t('devices.preview')}</Button>
            <a href="/devices">{t('devices.cancel')}</a>
          </div>
        </form>
        {state === 'loading' && <p role="status" {...stylex.props(styles.status)}>{t('devices.checking')}</p>}
        {state === 'invalid' && <p role="alert" {...stylex.props(styles.status, styles.error)}>{t('devices.invalidCode')}</p>}
        {state === 'expired' && <p role="alert" {...stylex.props(styles.status, styles.error)}>{t('devices.expiredCode')}</p>}
        {state === 'network' && <p role="alert" {...stylex.props(styles.status, styles.error)}>{t('devices.networkError', { error })}<Button className={stylex.props(styles.button).className} size="small" onClick={() => void preview(input)}>{t('devices.retry')}</Button></p>}
        {state === 'unconfirmed' && <p role="alert" {...stylex.props(styles.status, styles.error)}>{t('devices.unconfirmed')}</p>}
        {(state === 'approved' || state === 'denied') && <div role="status" {...stylex.props(styles.preview)}><ShieldCheck aria-hidden="true" size={20} /><h2 {...stylex.props(styles.sectionTitle)}>{t(state === 'approved' ? 'devices.approved' : 'devices.denied')}</h2><p {...stylex.props(styles.copy)}>{t(state === 'approved' ? 'devices.approvedCopy' : 'devices.deniedCopy')}</p><a href="/devices">{t('devices.backToDevices')}</a></div>}
        {state === 'preview' && pairing && (
          <div {...stylex.props(styles.preview)}>
            <h2 {...stylex.props(styles.pairingName)}>{pairing.pairing.name}</h2>
            <p {...stylex.props(styles.copy)}>{t('devices.checkCode')}</p>
            <strong {...stylex.props(styles.pairCode)}>{pairing.pairing.code.replaceAll('-', ' · ')}</strong>
            <p {...stylex.props(styles.copy)}>{t('devices.pairExpires', { time: new Date(pairing.pairing.expiresAt).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' }) })}</p>
            <h3 {...stylex.props(styles.sectionTitle)}>{t('devices.allowedProjects')}</h3>
            {pairing.projects.length === 0 ? <p role="alert" {...stylex.props(styles.copy, styles.error)}>{t('devices.noProjects')}</p> : (
              <ul {...stylex.props(styles.projectList)}>
                {pairing.projects.map((project) => <li key={project.id}>
                  <label {...stylex.props(styles.projectOption)}>
                    <input checked={chosen.has(project.id)} type="checkbox" value={project.id} {...stylex.props(styles.check)} onChange={() => toggleProject(project.id)} />
                    <span>{project.name}</span>
                  </label>
                </li>)}
              </ul>
            )}
            <p {...stylex.props(styles.copy)}>{t('devices.projectImpact')}</p>
            {error && <p role="alert" {...stylex.props(styles.error)}>{error}</p>}
            <div {...stylex.props(styles.actions)}>
              <Button className={stylex.props(styles.button).className} disabled={chosen.size === 0} type="primary" onClick={() => void decide('approve')}>{t('devices.approve')}</Button>
              <Button className={stylex.props(styles.button).className} danger type="text" onClick={() => void decide('deny')}>{t('devices.deny')}</Button>
            </div>
          </div>
        )}
        <p {...stylex.props(styles.note)}><Info aria-hidden="true" size={13} />{t('devices.guideBrowser')}</p>
      </div>
    </section>
  );
}

export function DevicePage({ connect }: { connect: boolean }) {
  return connect ? <ConnectDevice /> : <DevicesList />;
}
