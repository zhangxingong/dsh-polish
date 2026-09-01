// 白盒单测：trust-fence（lib/trust-fence.js 真实实现，模板自 composer-tools 官方 fence 移植）
import test from 'node:test'
import assert from 'node:assert/strict'
import { isTrustedPolishRequest } from '../../lib/trust-fence.js'

/** 造一个只带 headers 的 req（fence 只读 headers）。 */
function req(headers) {
  return { headers }
}

test.describe('trust-fence', () => {
  test('接受 localhost Host', () => {
    assert.equal(isTrustedPolishRequest(req({ host: 'localhost:3080' })), true)
  })
  test('接受 127.0.0.1 Host', () => {
    assert.equal(isTrustedPolishRequest(req({ host: '127.0.0.1:3080' })), true)
  })
  test('接受 [::1] Host', () => {
    assert.equal(isTrustedPolishRequest(req({ host: '[::1]:3080' })), true)
  })
  test('拒绝非 loopback Host', () => {
    assert.equal(isTrustedPolishRequest(req({ host: 'evil.example.com:3080' })), false)
  })
  test('拒绝 cross-site Sec-Fetch-Site', () => {
    assert.equal(
      isTrustedPolishRequest(req({ host: '127.0.0.1:3080', 'sec-fetch-site': 'cross-site' })),
      false,
    )
  })
  test('拒绝与 Host 不同源的 Origin', () => {
    assert.equal(
      isTrustedPolishRequest(req({ host: '127.0.0.1:3080', origin: 'https://evil.example.com' })),
      false,
    )
  })
  test('接受与 Host 同源的 Origin', () => {
    assert.equal(
      isTrustedPolishRequest(req({ host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' })),
      true,
    )
  })
  test('拒绝缺失 Host', () => {
    assert.equal(isTrustedPolishRequest(req({})), false)
  })
  test('无 Origin 头时放行 loopback', () => {
    assert.equal(isTrustedPolishRequest(req({ host: '127.0.0.1:3080' })), true)
  })
})
