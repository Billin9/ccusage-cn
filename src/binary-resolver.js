// @ts-check
/**
 * 上游二进制解析器
 *
 * 封装上游 resolveCliRuntime 调用，定位平台特定原生二进制路径。
 * 如果 subpath import 失败（上游添加 exports 字段限制导出），回退到本地二进制路径解析。
 */
import process from 'node:process';

/**
 * 回退实现：获取与平台匹配的 optionalDependencies 包名
 *
 * 此逻辑来自上游的 getNativePackageName 函数，在 subpath import 不可用时作为后备。
 *
 * @param {string} [platform]
 * @param {string} [arch]
 * @returns {string | undefined}
 */
function getNativePackageName(platform = process.platform, arch = process.arch) {
  if (platform === 'darwin') {
    if (arch === 'arm64') return '@ccusage/ccusage-darwin-arm64';
    if (arch === 'x64') return '@ccusage/ccusage-darwin-x64';
    return undefined;
  }
  if (platform === 'linux') {
    if (arch === 'arm64') return '@ccusage/ccusage-linux-arm64';
    if (arch === 'x64') return '@ccusage/ccusage-linux-x64';
    return undefined;
  }
  if (platform === 'win32') {
    if (arch === 'arm64') return '@ccusage/ccusage-win32-arm64';
    if (arch === 'x64') return '@ccusage/ccusage-win32-x64';
  }
  return undefined;
}

/**
 * 获取原生二进制的子路径（相对于平台特定包）
 *
 * @param {string} [platform]
 * @returns {string}
 */
function getNativeBinarySubpath(platform = process.platform) {
  return platform === 'win32' ? 'bin/ccusage.exe' : 'bin/ccusage';
}

/**
 * 使用上游的 resolveCliRuntime 解析二进制路径
 *
 * 优先通过 ESM 动态导入使用上游的 API，如果导入失败则回退到本地实现。
 *
 * @param {string[]} argv - CLI 参数字符串数组
 * @returns {Promise<{ command: string; args: string[] }>}
 */
export async function resolveBinary(argv) {
  // 尝试通过 ESM import 使用上游 API
  try {
    const { resolveCliRuntime, ensureNativeBinaryExecutable } = await import('ccusage/src/cli.js');

    const runtime = resolveCliRuntime({ argv });

    if ('errorMessage' in runtime) {
      console.error(runtime.errorMessage);
      process.exit(1);
    }

    // 确保二进制可执行（非 Windows 平台设置执行权限）
    ensureNativeBinaryExecutable({ binaryPath: runtime.command });

    return { command: runtime.command, args: runtime.args };
  } catch {
    // import 失败，使用回退逻辑
  }

  // 回退路径：subpath import 不可用时自实现二进制路径解析
  const packageName = getNativePackageName();
  if (packageName === undefined) {
    console.error(
      `ccusage native binary is not available for ${process.platform}-${process.arch}. ` +
      'Reinstall ccusage so optional native dependencies are installed.'
    );
    process.exit(1);
  }

  const subpath = getNativeBinarySubpath();
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);

  let binaryPath;
  try {
    binaryPath = require.resolve(`${packageName}/${subpath}`);
  } catch {
    console.error(
      `ccusage native binary (${packageName}) not found. ` +
      'Reinstall ccusage to install optional native dependencies.'
    );
    process.exit(1);
  }

  return { command: binaryPath, args: argv };
}
