import { describe, expect, it } from 'vitest'

import { shouldHideGlobalChrome } from './layoutChrome'

describe('shouldHideGlobalChrome', () => {
  it('hides global chrome on the dedicated WeChat group QR page', () => {
    expect(shouldHideGlobalChrome('/qr/world-wechat-group')).toBe(true)
    expect(shouldHideGlobalChrome('/qr/lggc-wechat-group')).toBe(true)
  })
})
