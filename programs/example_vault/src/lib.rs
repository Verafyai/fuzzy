//! `example_vault`: a deliberately vulnerable benchmark for Fuzzy.
//!
//! A vault holds SOL for an authority. Anchor-style 8-byte discriminators, so
//! Fuzzy drives it from `example_vault.json`, an Anchor-format IDL.
//!
//! Instructions:
//! - `initialize` (vault w, authority s): write the Vault header and authority.
//! - `withdraw(amount: u64)` (vault w, authority, recipient w): move lamports
//!   from the vault to the recipient if `authority` is the vault's authority.
//! - `ping` (vault): read-only check that the vault is initialized.
//!
//! The two bugs, both closed by the `fixed` feature:
//! 1. `withdraw` compares the authority's key but never checks that it signed,
//!    so anyone can name the authority and drain the vault (missing signer check).
//! 2. `initialize` never checks the vault is new, so anyone can re-initialize a
//!    funded vault with themselves as authority (reinitialization).
#![cfg_attr(target_os = "solana", no_std)]

use abi::{err, Input, Reader};

pub const IX_INITIALIZE: [u8; 8] = [175, 175, 109, 31, 13, 152, 155, 237];
pub const IX_WITHDRAW: [u8; 8] = [183, 18, 70, 156, 148, 109, 161, 34];
pub const IX_PING: [u8; 8] = [173, 0, 94, 236, 73, 133, 225, 153];
pub const VAULT_DISC: [u8; 8] = [211, 8, 232, 43, 2, 152, 117, 119];
pub const VAULT_LEN: usize = 48; // discriminator, authority, withdrawn

pub const NOT_INITIALIZED: u64 = 6000;
pub const ALREADY_INITIALIZED: u64 = 6001;
pub const WRONG_AUTHORITY: u64 = 6002;
pub const MISSING_SIGNATURE: u64 = 6003;
pub const INSUFFICIENT_FUNDS: u64 = 6004;
/// Lamports a vault always keeps, so it stays rent exempt.
pub const RESERVE: u64 = 1_000_000;

fn process(ix: &mut Input) -> Result<(), u64> {
    let mut r = Reader::new(ix.data);
    let disc = r.bytes(8)?;
    if disc == IX_INITIALIZE {
        r.end()?;
        ix.expect(2)?;
        let pid = *ix.program_id;
        let authority = ix.accounts[1].as_ref().ok_or(err::BAD_ACCOUNTS)?;
        let (auth_key, auth_signed) = (*authority.key, authority.is_signer);
        if !auth_signed {
            return Err(MISSING_SIGNATURE);
        }
        let vault = ix.accounts[0].as_mut().ok_or(err::BAD_ACCOUNTS)?;
        if !vault.is_writable || *vault.owner != pid || vault.data.len() < VAULT_LEN {
            return Err(err::BAD_ACCOUNTS);
        }
        if cfg!(feature = "fixed") && vault.data[0..8] == VAULT_DISC {
            return Err(ALREADY_INITIALIZED);
        }
        vault.data[0..8].copy_from_slice(&VAULT_DISC);
        vault.data[8..40].copy_from_slice(&auth_key);
        vault.data[40..48].copy_from_slice(&0u64.to_le_bytes());
        Ok(())
    } else if disc == IX_WITHDRAW {
        let amount = r.u64()?;
        r.end()?;
        ix.expect(3)?;
        let pid = *ix.program_id;
        let authority = ix.accounts[1].as_ref().ok_or(err::BAD_ACCOUNTS)?;
        let (auth_key, auth_signed) = (*authority.key, authority.is_signer);
        if cfg!(feature = "fixed") && !auth_signed {
            return Err(MISSING_SIGNATURE);
        }
        let _ = auth_signed;
        let vault = ix.accounts[0].as_mut().ok_or(err::BAD_ACCOUNTS)?;
        if !vault.is_writable || *vault.owner != pid || vault.data.len() < VAULT_LEN {
            return Err(err::BAD_ACCOUNTS);
        }
        if vault.data[0..8] != VAULT_DISC {
            return Err(NOT_INITIALIZED);
        }
        if vault.data[8..40] != auth_key {
            return Err(WRONG_AUTHORITY);
        }
        let vault_lamports = unsafe { *vault.raw.lamports };
        if amount == 0 || vault_lamports < amount.checked_add(RESERVE).ok_or(err::OVERFLOW)? {
            return Err(INSUFFICIENT_FUNDS);
        }
        let mut w = [0u8; 8];
        w.copy_from_slice(&vault.data[40..48]);
        let withdrawn = u64::from_le_bytes(w).checked_add(amount).ok_or(err::OVERFLOW)?;
        vault.data[40..48].copy_from_slice(&withdrawn.to_le_bytes());
        let vault_lp = vault.raw.lamports;
        let recipient = ix.accounts[2].as_mut().ok_or(err::BAD_ACCOUNTS)?;
        if !recipient.is_writable {
            return Err(err::BAD_ACCOUNTS);
        }
        unsafe {
            *vault_lp -= amount;
            *recipient.raw.lamports = (*recipient.raw.lamports).checked_add(amount).ok_or(err::OVERFLOW)?;
        }
        Ok(())
    } else if disc == IX_PING {
        r.end()?;
        ix.expect(1)?;
        let vault = ix.accounts[0].as_ref().ok_or(err::BAD_ACCOUNTS)?;
        if vault.data.len() < VAULT_LEN || vault.data[0..8] != VAULT_DISC {
            return Err(NOT_INITIALIZED);
        }
        Ok(())
    } else {
        Err(err::BAD_INPUT)
    }
}

abi::entrypoint!(process);
