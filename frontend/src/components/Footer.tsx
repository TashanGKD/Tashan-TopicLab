import { Link } from 'react-router-dom'

const footerLinks = {
  product: [
    { label: '首页', to: '/' },
    { label: '信息', to: '/info' },
    { label: '库', to: '/library' },
  ],
  resources: [
    { label: '科研数字分身', to: '/profile-helper' },
  ],
  about: [
    { label: '关于我们', href: 'https://tashan.ac.cn' },
    { label: '联系方式', href: 'mailto:tashanxkjc@163.com' },
  ],
}

export default function Footer() {
  const currentYear = new Date().getFullYear()
  const wechatGroupQrUrl = `${import.meta.env.BASE_URL}api/v1/site/assets/wechat-group-qr.webp`

  return (
    <footer
      className="w-full mt-auto"
      style={{
        backgroundColor: 'var(--bg-footer)',
      }}
    >
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12">
        <div className="grid grid-cols-1 gap-8 mb-8 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-start">
          {/* Logo & Slogan */}
          <div className="md:col-span-1">
            <Link to="/" className="flex items-center gap-3 mb-4">
              <img
                src="/media/logo_complete.svg"
                alt="他山"
                className="h-10 w-auto brightness-0 invert"
              />
              <span
                className="font-sans font-semibold text-xl tracking-widest"
                style={{ color: 'white' }}
              >
                · 世 界
              </span>
            </Link>
            <p
              className="text-sm leading-relaxed"
              style={{ color: 'rgba(255, 255, 255, 0.7)' }}
            >
              对齐需求，寻找协作
              <br />
              在讨论中推进科学发现
            </p>
          </div>

          {/* 产品 - 暂时隐藏 */}
          {/* <div>
            <h4
              className="font-medium mb-4"
              style={{ color: 'white' }}
            >
              产品
            </h4>
            <ul className="space-y-2">
              {footerLinks.product.map((link) => (
                <li key={link.to}>
                  <Link
                    to={link.to}
                    className="text-sm transition-all hover:opacity-100"
                    style={{ color: 'rgba(255, 255, 255, 0.7)' }}
                    onMouseEnter={(e) => e.currentTarget.style.color = 'white'}
                    onMouseLeave={(e) => e.currentTarget.style.color = 'rgba(255, 255, 255, 0.7)'}
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div> */}

          {/* 资源 - 暂时隐藏 */}
          {/* <div>
            <h4
              className="font-medium mb-4"
              style={{ color: 'white' }}
            >
              资源
            </h4>
            <ul className="space-y-2">
              {footerLinks.resources.map((link) => (
                <li key={link.to}>
                  <Link
                    to={link.to}
                    className="text-sm transition-all hover:opacity-100"
                    style={{ color: 'rgba(255, 255, 255, 0.7)' }}
                    onMouseEnter={(e) => e.currentTarget.style.color = 'white'}
                    onMouseLeave={(e) => e.currentTarget.style.color = 'rgba(255, 255, 255, 0.7)'}
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div> */}

          {/* 关于 */}
          <div className="flex justify-start">
            <div className="text-left">
              <h4
                className="font-medium mb-4"
                style={{ color: 'white' }}
              >
                关于
              </h4>
              <ul className="space-y-2">
                {footerLinks.about.map((link, idx) => (
                  <li key={idx}>
                    <a
                      href={link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm transition-all hover:opacity-100"
                      style={{ color: 'rgba(255, 255, 255, 0.7)' }}
                      onMouseEnter={(e) => e.currentTarget.style.color = 'white'}
                      onMouseLeave={(e) => e.currentTarget.style.color = 'rgba(255, 255, 255, 0.7)'}
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>

              {/* 社交图标 */}
              <div className="flex gap-3 mt-4 justify-start">
              <a
                href="mailto:tashanxkjc@163.com"
                className="w-9 h-9 rounded-lg flex items-center justify-center transition-all"
                style={{
                  background: 'rgba(255, 255, 255, 0.1)',
                  color: 'rgba(255, 255, 255, 0.7)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.2)'
                  e.currentTarget.style.color = 'white'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)'
                  e.currentTarget.style.color = 'rgba(255, 255, 255, 0.7)'
                }}
                aria-label="Email"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                </svg>
              </a>
              <a
                href="https://github.com/TashanGKD"
                target="_blank"
                rel="noopener noreferrer"
                className="w-9 h-9 rounded-lg flex items-center justify-center transition-all"
                style={{
                  background: 'rgba(255, 255, 255, 0.1)',
                  color: 'rgba(255, 255, 255, 0.7)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.2)'
                  e.currentTarget.style.color = 'white'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)'
                  e.currentTarget.style.color = 'rgba(255, 255, 255, 0.7)'
                }}
                aria-label="GitHub"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
                </svg>
              </a>
            </div>
          </div>
          </div>
          <div className="max-w-[8rem] text-center">
            <p className="mb-2 whitespace-nowrap text-xs font-medium leading-5" style={{ color: 'white' }}>
              他山世界交流群
            </p>
            <img
              src={wechatGroupQrUrl}
              alt="他山世界交流群二维码"
              className="block w-28"
              loading="lazy"
            />
          </div>
        </div>

        {/* Divider */}
        <div
          className="w-full h-px mb-6"
          style={{ background: 'rgba(255, 255, 255, 0.1)' }}
        />

        {/* Copyright */}
        <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
          <p
            className="text-xs"
            style={{ color: 'rgba(255, 255, 255, 0.5)' }}
          >
            © {currentYear} 他山·世界. All rights reserved.
          </p>
          <p
            className="text-xs"
            style={{ color: 'rgba(255, 255, 255, 0.5)' }}
          >
            Powered by{' '}
            <a
              href="https://tashan.ac.cn"
              target="_blank"
              rel="noopener noreferrer"
              className="transition-all hover:opacity-80"
              style={{ color: 'white' }}
            >
              他山学科交叉创新协会
            </a>
          </p>
        </div>
      </div>
    </footer>
  )
}
