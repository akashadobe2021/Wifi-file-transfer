import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculatePieceCount,
  calculateProgressPercentage,
  calculateSpeedAndEta,
  calculateAggregateTransferSpeed,
  formatTransferSpeed,
  scheduleConcurrentTransfers,
  advanceActiveTransfers,
  validateFolderName,
  normalizeFolderPath,
  validateNetworkAddress,
  formatNetworkAccessUrl,
  rankLanIpv4Address,
  getParentVirtualPath,
  validateDiskMountInput,
  computeDeterministicChecksum,
  type TransferJob,
} from './transferEngine';

function createMockJob(id: string, fileSizeBytes: number, chunkSizeBytes = 65536): TransferJob {
  const totalPieces = calculatePieceCount(fileSizeBytes, chunkSizeBytes);
  return {
    id,
    fileName: `file-${id}.bin`,
    fileSizeBytes,
    mimeType: 'application/octet-stream',
    sourceEndpoint: 'host',
    targetEndpoint: 'receiver',
    targetFolderPath: '/Incoming',
    chunkSizeBytes,
    totalPieces,
    completedPieces: 0,
    bytesTransferred: 0,
    status: 'queued',
    startedAtMs: null,
    elapsedMs: 0,
    speedBytesPerSec: 0,
    etaSeconds: null,
    pieceBlocks: [],
    checksum: computeDeterministicChecksum(`file-${id}.bin`, fileSizeBytes),
  };
}

test('calculatePieceCount splits files into small packet chunks accurately', () => {
  assert.equal(calculatePieceCount(655360, 65536), 10);
  assert.equal(calculatePieceCount(655361, 65536), 11);
  assert.equal(calculatePieceCount(0, 65536), 1);
});

test('calculateSpeedAndEta computes throughput, blends instantaneous chunk speed, and handles sub-50ms transfers', () => {
  const { speedBytesPerSec, etaSeconds } = calculateSpeedAndEta(500_000, 1_500_000, 1000);
  assert.equal(speedBytesPerSec, 500_000);
  assert.equal(etaSeconds, 2);

  const done = calculateSpeedAndEta(1_500_000, 1_500_000, 3000);
  assert.equal(done.etaSeconds, 0);
  assert.equal(done.speedBytesPerSec, 500_000);

  // Sub-50ms high-speed local chunk transfer
  const fastLocal = calculateSpeedAndEta(65536, 262144, 10, 65536, 10);
  assert.ok(fastLocal.speedBytesPerSec > 1_000_000);
  assert.equal(fastLocal.etaSeconds, 1);
});

test('formatTransferSpeed and calculateAggregateTransferSpeed format real-time MB/s accurately', () => {
  assert.equal(formatTransferSpeed(0), '0.00 MB/s');
  assert.equal(formatTransferSpeed(10 * 1024 * 1024), '10.00 MB/s');
  assert.equal(formatTransferSpeed(1.5 * 1024 * 1024), '1.50 MB/s');
  assert.equal(formatTransferSpeed(50 * 1024), '50.0 KB/s');

  const j1 = { ...createMockJob('1', 1024), status: 'transferring' as const, speedBytesPerSec: 2_000_000 };
  const j2 = { ...createMockJob('2', 1024), status: 'transferring' as const, speedBytesPerSec: 3_500_000 };
  const j3 = { ...createMockJob('3', 1024), status: 'queued' as const, speedBytesPerSec: 1_000_000 };
  assert.equal(calculateAggregateTransferSpeed([j1, j2, j3]), 5_500_000);
});

test('scheduleConcurrentTransfers starts at least 5 files simultaneously when multiple files are selected', () => {
  const queuedJobs = Array.from({ length: 7 }, (_, idx) =>
    createMockJob(String(idx + 1), 512 * 1024, 65536)
  );

  const scheduled = scheduleConcurrentTransfers(queuedJobs, 5, 1000);
  const activeCount = scheduled.filter((j) => j.status === 'transferring').length;
  const remainingQueued = scheduled.filter((j) => j.status === 'queued').length;

  assert.equal(activeCount, 5);
  assert.equal(remainingQueued, 2);
});

test('advanceActiveTransfers progresses chunks in parallel and promotes queued files upon completion', () => {
  const initialJobs = scheduleConcurrentTransfers(
    Array.from({ length: 6 }, (_, idx) => createMockJob(String(idx + 1), 131072, 65536)),
    5,
    1000
  );

  const { updatedJobs, newlyCompletedJobs } = advanceActiveTransfers(initialJobs, 250, 2, 5);
  assert.equal(newlyCompletedJobs.length, 5);
  assert.equal(updatedJobs[5].status, 'transferring');
  assert.equal(calculateProgressPercentage(updatedJobs[0].completedPieces, updatedJobs[0].totalPieces), 100);
});

test('validateFolderName and normalizeFolderPath handle host and receiver directories safely', () => {
  assert.equal(validateFolderName('Design_Packets_2026').valid, true);
  assert.equal(validateFolderName('').valid, false);
  assert.equal(validateFolderName('../etc').valid, false);
  assert.equal(normalizeFolderPath('/Shared/', 'Builds'), '/Shared/Builds');
});

test('validateNetworkAddress, formatNetworkAccessUrl, and rankLanIpv4Address handle LAN IPs and reject 0.0.0.0', () => {
  const validLan = validateNetworkAddress('192.168.1.42', 3000);
  assert.equal(validLan.valid, true);
  assert.equal(validLan.hostPort, '192.168.1.42:3000');
  assert.equal(validLan.url, 'http://192.168.1.42:3000');

  const withCustomPort = validateNetworkAddress('http://192.168.43.1:8080/');
  assert.equal(withCustomPort.valid, true);
  assert.equal(withCustomPort.hostPort, '192.168.43.1:8080');
  assert.equal(withCustomPort.url, 'http://192.168.43.1:8080');

  const invalidOctet = validateNetworkAddress('192.168.1.999', 3000);
  assert.equal(invalidOctet.valid, false);

  const invalidZeroBind = validateNetworkAddress('0.0.0.0:3000', 3000);
  assert.equal(invalidZeroBind.valid, false);

  assert.equal(formatNetworkAccessUrl('0.0.0.0:3000', 3000), 'http://localhost:3000');
  assert.equal(formatNetworkAccessUrl('10.0.0.15', 3000), 'http://10.0.0.15:3000');

  assert.ok(rankLanIpv4Address('192.168.1.10') < rankLanIpv4Address('169.254.8.1'));
  assert.ok(rankLanIpv4Address('10.0.0.5') < rankLanIpv4Address('169.254.8.1'));
});

test('getParentVirtualPath and validateDiskMountInput support direct disk drive navigation and mounting', () => {
  assert.equal(getParentVirtualPath('/'), '/');
  assert.equal(getParentVirtualPath('/Users'), '/');
  assert.equal(getParentVirtualPath('/Users/akash/Downloads'), '/Users/akash');

  assert.equal(validateDiskMountInput('C:\\Users\\akash\\Downloads').valid, true);
  assert.equal(validateDiskMountInput('D:\\').valid, true);
  assert.equal(validateDiskMountInput('/tmp').valid, true);
  assert.equal(validateDiskMountInput('   ').valid, false);
});



