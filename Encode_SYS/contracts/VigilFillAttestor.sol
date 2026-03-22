// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title VigilFillAttestor
 * @notice On-chain audit receipts for the Vigil trading system.
 *
 *         - attest(): per-fill receipt (fillHash from fill id + order id + ts)
 *         - attestEvent(): general-purpose event receipt (guardrail blocks,
 *           kill-switch toggles, strategy commitments, Merkle rollup roots)
 *
 *         Pure event emitters — no state, no Coinbase verification.
 */
contract VigilFillAttestor {
    event FillAttested(
        bytes32 indexed fillHash,
        string clientOrderId,
        uint8 side,
        uint256 ts
    );

    /// @dev eventType: 1=block, 2=kill_switch_on, 3=kill_switch_off,
    ///      4=strategy_commitment, 5=merkle_rollup
    event EventAttested(
        uint8 indexed eventType,
        bytes32 indexed dataHash,
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

    /// @param eventType see EventAttested natspec
    function attestEvent(
        uint8 eventType,
        bytes32 dataHash,
        uint256 ts
    ) external {
        emit EventAttested(eventType, dataHash, ts);
    }
}
