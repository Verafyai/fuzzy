//! `fuzzy_drainer`: the program Fuzzy passes in place of a program a target
//! calls (unchecked CPI target). It does nothing a real program would: it moves
//! no funds and writes no state, and returns success. If the target calls it and
//! goes on as if the real program ran (a transfer that never happened, say), the
//! attacker ends up ahead, and Fuzzy measures that.
//!
//! It logs `FUZZY_CPI_HIJACK`, then one `FUZZY_CPI_SIGNER <hex key>` line per
//! account that arrived as a signer, so Fuzzy can tell when a target handed an
//! attacker-chosen program a signature (its own PDA's, or a user's).
#![cfg_attr(target_os = "solana", no_std)]

use abi::Input;

const HEX: &[u8; 16] = b"0123456789abcdef";

fn process(ix: &mut Input) -> Result<(), u64> {
    abi::log("FUZZY_CPI_HIJACK");
    let mut line = [0u8; 17 + 64];
    line[..17].copy_from_slice(b"FUZZY_CPI_SIGNER ");
    for a in ix.accounts.iter().take(ix.count).flatten() {
        if !a.is_signer {
            continue;
        }
        for (i, b) in a.key.iter().enumerate() {
            line[17 + 2 * i] = HEX[(b >> 4) as usize];
            line[18 + 2 * i] = HEX[(b & 15) as usize];
        }
        abi::log(core::str::from_utf8(&line).unwrap_or("FUZZY_CPI_SIGNER ?"));
    }
    Ok(())
}

abi::entrypoint!(process);
