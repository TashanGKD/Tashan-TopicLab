import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { adminApi, adminPanelTokenManager } from '../api/admin';
import { ssoAdmin, siteConfiguration, type SsoClient, type SsoConfig, type SsoUser } from '../api/ssoAdmin';

export default function AdminSsoPage() {
  const navigate = useNavigate();
  const [clients,setClients] = useState<SsoClient[]>([]);
  const [name,setName] = useState(''), [origin,setOrigin] = useState('');
  const [ready,setReady] = useState<SsoConfig|null>(null);
  const [busy,setBusy] = useState(false), [error,setError] = useState(''), [notice,setNotice] = useState('');
  const [query,setQuery] = useState(''), [users,setUsers] = useState<SsoUser[]>([]);
  const refresh = async () => setClients((await ssoAdmin.list()).clients);
  useEffect(() => {
    if (!adminPanelTokenManager.get()) { navigate('/admin/login', {replace:true}); return; }
    void adminApi.me().then(() => refresh().catch(e => setError(e instanceof Error ? e.message : '网站列表加载失败'))).catch(() => navigate('/admin/login', {replace:true}));
  }, [navigate]);
  async function run(action: () => Promise<void>) {
    setBusy(true); setError(''); setNotice('');
    try { await action(); } catch(e) { setError(e instanceof Error ? e.message : '操作失败，请稍后重试'); }
    finally { setBusy(false); }
  }
  function download() {
    if (!ready) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(siteConfiguration(ready),null,2)+'\n'],{type:'application/json'}));
    const a = document.createElement('a'); a.href=url; a.download=`tashan-${ready.client_id}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url),1000);
  }
  const button = 'rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:opacity-50';
  const input = 'w-full rounded-lg border border-slate-300 px-3 py-2';
  return <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900">
    <div className="mx-auto max-w-4xl space-y-6">
      <Link to="/admin" className="text-sm text-blue-700">← 返回管理后台</Link>
      <header><h1 className="mt-3 text-3xl font-semibold">网站登录接入</h1><p className="mt-2 text-slate-600">让其他网站使用他山账号登录。登记一次即可生效，无需重启服务。</p></header>
      {error && <p role="alert" className="rounded-lg bg-red-50 p-4 text-red-800">{error}</p>}
      {notice && <p role="status" className="rounded-lg bg-green-50 p-4 text-green-800">{notice}</p>}
      <section className="rounded-xl border bg-white p-6">
        <h2 className="text-xl font-semibold">接入新网站</h2>
        <form className="mt-4 grid gap-4 sm:grid-cols-2" onSubmit={e => {e.preventDefault(); void run(async () => {setReady(await ssoAdmin.create(name,origin)); setName(''); setOrigin(''); await refresh();});}}>
          <label>网站名称<input className={input} value={name} onChange={e=>setName(e.target.value)} maxLength={100} required placeholder="例如：他山实验室" /></label>
          <label>网站地址<input className={input} type="url" value={origin} onChange={e=>setOrigin(e.target.value)} required placeholder="https://tools.example.com" /></label>
          <p className="text-sm text-slate-500 sm:col-span-2">填写网站首页地址，不带页面路径。系统会自动生成回调地址和接入凭据。</p>
          <button disabled={busy} className="rounded-lg bg-blue-700 px-4 py-2 text-white disabled:opacity-50">生成接入配置</button>
        </form>
        {ready && <div className="mt-5 rounded-lg bg-blue-50 p-4" role="status">
          <h3 className="font-semibold">{ready.name} 的配置已生成</h3>
          <p className="my-2 text-sm">下载配置，交给这个网站的开发者或开发助手，按接入工具的说明导入。文件含登录凭据，只能放在网站后端，不能提交到公开仓库。</p>
          <button className={button} onClick={download}>下载配置文件</button>
          <p className="mt-2 text-sm text-slate-600">离开页面后不能再次下载同一份密钥。丢失时可在下方重新生成。</p>
        </div>}
      </section>
      <section className="rounded-xl border bg-white p-6"><h2 className="text-xl font-semibold">已接入网站</h2>
        {!clients.length && <p className="mt-4 text-slate-500">还没有接入网站。</p>}
        <ul className="divide-y">{clients.map(c=><li key={c.client_id} className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div><p className="font-medium">{c.name} <span className="text-sm text-slate-500">{c.enabled ? '可用' : '已停用'}</span></p><p className="break-all text-sm text-slate-600">{c.origin}</p></div>
          <div className="flex flex-wrap gap-2"><button disabled={busy} className={button} onClick={()=>void run(async()=>{await ssoAdmin.toggle(c.client_id,!c.enabled); if(ready?.client_id===c.client_id)setReady(null); await refresh();setNotice(c.enabled?'网站已停用；现有登录将在下次复核时失效。':'网站已恢复，可以重新登录。');})}>{c.enabled?'停用':'恢复'}</button>
          <button disabled={busy} className={button} onClick={()=>{if(window.confirm('重新生成后，旧配置和现有登录会失效。需要把新配置导入该网站。继续吗？'))void run(async()=>{setReady(await ssoAdmin.rotate(c.client_id));await refresh();});}}>重新生成配置</button></div>
        </li>)}</ul>
      </section>
      <section className="rounded-xl border bg-white p-6"><h2 className="text-xl font-semibold">账号跨站登录管理</h2>
        <p className="mt-2 text-sm text-slate-600">可让账号退出所有接入网站，或暂停跨站登录。这里不改变账号在他山世界中的登录权限。接入网站在下次请求时复核，缓存最多 60 秒。</p>
        <form className="mt-4 flex gap-2" onSubmit={e=>{e.preventDefault();void run(async()=>setUsers((await ssoAdmin.users(query)).users));}}>
          <label className="flex-1"><span className="sr-only">搜索账号</span><input className={input} value={query} onChange={e=>setQuery(e.target.value)} placeholder="用户名、手机号或用户编号" required /></label><button disabled={busy} className={button}>查找</button>
        </form>
        <ul className="divide-y">{users.map(u=><li key={u.id} className="flex flex-wrap justify-between gap-3 py-3"><p>{u.username || '未命名账号'} · {u.id} · {u.enabled?'可跨站登录':'已暂停'}</p>
          <div className="flex gap-2"><button className={button} disabled={busy} onClick={()=>void run(async()=>{await ssoAdmin.user(u.id);setNotice('已撤销该账号的跨站登录。');})}>退出所有接入网站</button>
          <button className={button} disabled={busy} onClick={()=>void run(async()=>{await ssoAdmin.user(u.id,!u.enabled);setUsers((await ssoAdmin.users(query)).users);setNotice(u.enabled?'已暂停该账号的跨站登录。':'已恢复跨站登录。');})}>{u.enabled?'暂停跨站登录':'恢复跨站登录'}</button></div>
        </li>)}</ul>
      </section>
    </div>
  </main>;
}
