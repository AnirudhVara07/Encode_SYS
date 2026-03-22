// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title VigilFillAttestor
 * @notice Emits an on-chain receipt after a Coinbase brokerage fill. The fillHash is computed
 *         off-chain (Vigil backend) from fill id + Coinbase order id + timestamp; this contract
 *         does not verify Coinbase — it only stores a public, explorer-visible attestation.
 */
contract VigilFillAttestor {
    event FillAttested(
        bytes32 indexed fillHash,
        string clientOrderId,
        uint8 side,
        uint256 ts
    );

    /// @param side 1 = buy, 2 = sell
    function attest(
        bytes32 fillHash,
        string calldata clientOrderId,
        uint8 side,
        uint256 ts
    ) external {
        emit FillAttested(fillHash, clientOrderId, side, ts);
    }
}
