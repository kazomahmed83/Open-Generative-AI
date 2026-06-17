const path = require('path');

function pickBinaryAssetForPlatform({ platform, arch, zipNames, gpu = false }) {
    const isSdCliZip = (name) => name.startsWith('sd-master-') || name.includes('-bin-');
    const candidates = zipNames.filter(isSdCliZip);

    if (platform === 'darwin') {
        if (arch !== 'arm64') return null;
        return candidates.find((name) => name.includes('Darwin') && name.includes('arm64')) || null;
    }

    if (platform === 'win32') {
        // Note: this selects the sd-cli *binary*. The cuda12 binary needs the CUDA runtime DLLs,
        // shipped separately as the "cudart-…-cu12" bundle — fetch those via pickCudartAssetForPlatform.
        const winCandidates = candidates.filter((name) => /win-(avx2?|avx512|noavx|cuda12)-x64/.test(name));
        const cpuOrder = ['win-avx2-x64', 'win-avx-x64', 'win-avx512-x64', 'win-noavx-x64'];
        // With an NVIDIA GPU, prefer the CUDA binary; otherwise CPU-only (never pick CUDA on a non-GPU box).
        const order = gpu ? ['win-cuda12-x64', ...cpuOrder] : cpuOrder;
        for (const tag of order) {
            const hit = winCandidates.find((name) => name.includes(tag));
            if (hit) return hit;
        }
        return null;
    }

    if (platform === 'linux' && arch === 'arm64') {
        const linuxArmCandidates = candidates.filter((name) =>
            name.includes('Linux') && (name.includes('aarch64') || name.includes('arm64'))
        );
        const plain = linuxArmCandidates.find((name) => !name.includes('rocm') && !name.includes('vulkan'));
        return plain
            || linuxArmCandidates.find((name) => name.includes('vulkan'))
            || linuxArmCandidates.find((name) => name.includes('rocm'))
            || null;
    }

    const linuxCandidates = candidates.filter((name) => name.includes('Linux') && name.includes('x86_64'));
    const plain = linuxCandidates.find((name) => !name.includes('rocm') && !name.includes('vulkan'));
    return plain
        || linuxCandidates.find((name) => name.includes('vulkan'))
        || linuxCandidates.find((name) => name.includes('rocm'))
        || null;
}

// The Windows CUDA binary needs the CUDA runtime DLLs (cudart/cublas), shipped as a separate
// "cudart-…-cu12-x64" bundle in the same release. Returns its name (to download alongside the
// binary), or null when there's none / on non-Windows.
function pickCudartAssetForPlatform({ platform, zipNames }) {
    if (platform !== 'win32') return null;
    return (zipNames || []).find((n) => /cudart/i.test(n) && /cu(da)?12/i.test(n) && /x64/.test(n)) || null;
}

function getBundledBinaryResourceDir({ resourcesPath, platform, arch }) {
    const pathLib = platform === 'win32' ? path.win32 : path.posix;
    return pathLib.join(resourcesPath, 'local-ai', `${platform}-${arch}`, 'bin');
}

module.exports = {
    getBundledBinaryResourceDir,
    pickBinaryAssetForPlatform,
    pickCudartAssetForPlatform,
};
