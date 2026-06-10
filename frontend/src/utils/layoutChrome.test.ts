import { describe, expect, it } from 'vitest'

import { shouldHideGlobalChrome } from './layoutChrome'

describe('shouldHideGlobalChrome', () => {
  it('hides global chrome on the dedicated WeChat group QR page', () => {
    expect(shouldHideGlobalChrome('/qr/world-wechat-group')).toBe(true)
    expect(shouldHideGlobalChrome('/qr/lggc-wechat-group')).toBe(true)
  })

  it('hides global chrome on the immersive thinking page', () => {
    expect(shouldHideGlobalChrome('/thinking')).toBe(true)
  })

  it('keeps global chrome on the Challenge Cup topic page', () => {
    expect(shouldHideGlobalChrome('/challenge-cup-topic')).toBe(false)
  })
})
