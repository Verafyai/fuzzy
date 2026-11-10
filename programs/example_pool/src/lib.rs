//! `example_pool`: a deliberately vulnerable benchmark for Fuzzy's newer attack
//! classes. Built with `--features fixed` it is the clean control.
//!
//! A pool holds SOL. Each user has a receipt recording how much they deposited.
//! Anchor-style 8-byte discriminators; the IDL is `bench/example_pool.json`.
//!
//! Instructions:
//! - `init_receipt` (receipt w, owner s)
//! - `deposit(amount)` (pool w, receipt w, owner s w, system_program): the owner
//!   pays `amount` through the System program, and the receipt is credited.
//! - `withdraw(amount)` (pool w, receipt w, owner s, recipient w)
//! - `redeem(amount)` (pool w, user s w, oracle, system_program): the user pays
//!   `amount` and receives `amount * price / 1_000_000` at the oracle's price.
//! - `close_receipt` (pool w, receipt w, owner s, recipient w): pays out the
//!   receipt's credit and its lamports, closing it.
//! - `touch_treasury(bump)` (treasury w, payer s w, system_program): checks the
//!   treasury address ["treasury", bump] and sends it 0.001 SOL.
//!
//! The bugs, all closed by the `fixed` feature:
//! 1. Unchecked CPI target: `deposit` and `redeem` call whatever program is
//!    passed as system_program, so a do-nothing program credits a deposit that
//!    was never paid.
//! 2. Price manipulation: `redeem` trusts the oracle account without checking
//!    its owner, so an attacker-made price account sets the payout.
//! 3. Close, then reuse: `close_receipt` leaves the receipt's data, so a receipt
//!    revived in the same transaction can be closed and paid out again.
//! 4. PDA seed: `touch_treasury` accepts any bump, not just the canonical one.
//! 5. Reinitialization: `init_receipt` overwrites an existing receipt's owner.
#![cfg_attr(target_os = "solana", no_std)]

use abi::cpi::{self, Arg};
use abi::{err, Account, Input, Reader};

pub const IX_INIT_RECEIPT: [u8; 8] = [35, 50, 200, 55, 17, 245, 64, 246];
pub const IX_DEPOSIT: [u8; 8] = [242, 35, 198, 137, 82, 225, 242, 182];
pub const IX_WITHDRAW: [u8; 8] = [183, 18, 70, 156, 148, 109, 161, 34];
pub const IX_REDEEM: [u8; 8] = [184, 12, 86, 149, 70, 196, 97, 225];
pub const IX_CLOSE_RECEIPT: [u8; 8] = [126, 254, 244, 203, 124, 164, 134, 89];
pub const IX_TOUCH_TREASURY: [u8; 8] = [228, 149, 229, 230, 2, 14, 150, 190];
pub const RECEIPT_DISC: [u8; 8] = [39, 154, 73, 106, 80, 102, 145, 153];
pub const RECEIPT_LEN: usize = 48; // discriminator, owner, credit
/// The benchmark oracle's owner program: sha256("fuzzy:benchmark-oracle-owner").
pub const ORACLE_OWNER: [u8; 32] = [239, 120, 157, 182, 219, 125, 113, 84, 2, 198, 49, 47, 190, 148, 238, 222, 235, 91, 15, 241, 20, 79, 58, 55, 70, 163, 206, 233, 86, 110, 202, 20];
pub const ORACLE_MAGIC: [u8; 8] = *b"FZPRICE1";
pub const SYSTEM: [u8; 32] = [0u8; 32];

pub const NOT_INITIALIZED: u64 = 6000;
pub const ALREADY_INITIALIZED: u64 = 6001;
pub const WRONG_OWNER: u64 = 6002;
pub const MISSING_SIGNATURE: u64 = 6003;
pub const INSUFFICIENT_FUNDS: u64 = 6004;
pub const WRONG_PROGRAM: u64 = 6005;
pub const BAD_ORACLE: u64 = 6006;
pub const BAD_TREASURY: u64 = 6007;

fn take<'a>(ix: &mut Input<'a>, i: usize) -> Result<Account<'a>, u64> {
    ix.accounts.get_mut(i).and_then(|a| a.take()).ok_or(err::BAD_ACCOUNTS)
}

fn lamports(a: &Account) -> u64 {
    unsafe { *a.raw.lamports }
}

/// Move lamports out of an account this program owns.
fn pay(from: &Account, to: &Account, amount: u64) -> Result<(), u64> {
    if amount == 0 {
        return Ok(());
    }
    unsafe {
        let have = *from.raw.lamports;
        *from.raw.lamports = have.checked_sub(amount).ok_or(INSUFFICIENT_FUNDS)?;
        *to.raw.lamports = (*to.raw.lamports).checked_add(amount).ok_or(err::OVERFLOW)?;
    }
    Ok(())
}

/// Pay `amount` from `from` (a signer) to `to` through the program passed as `system`.
fn system_transfer(system: &Account, from: &Account, to: &Account, amount: u64, seeds: &[&[u8]]) -> Result<(), u64> {
    if cfg!(feature = "fixed") && *system.key != SYSTEM {
        return Err(WRONG_PROGRAM);
    }
    let mut data = [0u8; 12];
    data[0] = 2;
    data[4..12].copy_from_slice(&amount.to_le_bytes());
    cpi::invoke_signed(system.key, system.raw, &[Arg { raw: from.raw, writable: true, signer: true }, Arg { raw: to.raw, writable: true, signer: false }], &data, seeds)
}

fn read_u64(b: &[u8]) -> u64 {
    let mut a = [0u8; 8];
    a.copy_from_slice(&b[..8]);
    u64::from_le_bytes(a)
}

fn receipt_for(receipt: &Account, owner: &Account, pid: &[u8; 32]) -> Result<u64, u64> {
    if *receipt.owner != *pid || receipt.data.len() < RECEIPT_LEN {
        return Err(err::BAD_ACCOUNTS);
    }
    if receipt.data[0..8] != RECEIPT_DISC {
        return Err(NOT_INITIALIZED);
    }
    if receipt.data[8..40] != owner.key[..] {
        return Err(WRONG_OWNER);
    }
    if !owner.is_signer {
        return Err(MISSING_SIGNATURE);
    }
    Ok(read_u64(&receipt.data[40..48]))
}

fn process(ix: &mut Input) -> Result<(), u64> {
    let pid = *ix.program_id;
    let mut r = Reader::new(ix.data);
    let disc = r.bytes(8)?;
    if disc == IX_INIT_RECEIPT {
        r.end()?;
        ix.expect(2)?;
        let receipt = take(ix, 0)?;
        let owner = take(ix, 1)?;
        if !owner.is_signer {
            return Err(MISSING_SIGNATURE);
        }
        if !receipt.is_writable || *receipt.owner != pid || receipt.data.len() < RECEIPT_LEN {
            return Err(err::BAD_ACCOUNTS);
        }
        if cfg!(feature = "fixed") && receipt.data[0..8] == RECEIPT_DISC {
            return Err(ALREADY_INITIALIZED);
        }
        receipt.data[0..8].copy_from_slice(&RECEIPT_DISC);
        receipt.data[8..40].copy_from_slice(owner.key);
        receipt.data[40..48].copy_from_slice(&0u64.to_le_bytes());
        Ok(())
    } else if disc == IX_DEPOSIT {
        let amount = r.u64()?;
        r.end()?;
        ix.expect(4)?;
        let pool = take(ix, 0)?;
        let receipt = take(ix, 1)?;
        let owner = take(ix, 2)?;
        let system = take(ix, 3)?;
        if *pool.owner != pid || !pool.is_writable {
            return Err(err::BAD_ACCOUNTS);
        }
        let credit = receipt_for(&receipt, &owner, &pid)?;
        if amount == 0 {
            return Err(err::OUT_OF_BOUNDS);
        }
        system_transfer(&system, &owner, &pool, amount, &[])?;
        let credit = credit.checked_add(amount).ok_or(err::OVERFLOW)?;
        receipt.data[40..48].copy_from_slice(&credit.to_le_bytes());
        Ok(())
    } else if disc == IX_WITHDRAW {
        let amount = r.u64()?;
        r.end()?;
        ix.expect(4)?;
        let pool = take(ix, 0)?;
        let receipt = take(ix, 1)?;
        let owner = take(ix, 2)?;
        let recipient = take(ix, 3)?;
        if *pool.owner != pid || !pool.is_writable || !recipient.is_writable {
            return Err(err::BAD_ACCOUNTS);
        }
        let credit = receipt_for(&receipt, &owner, &pid)?;
        if amount == 0 || amount > credit {
            return Err(INSUFFICIENT_FUNDS);
        }
        pay(&pool, &recipient, amount)?;
        receipt.data[40..48].copy_from_slice(&(credit - amount).to_le_bytes());
        Ok(())
    } else if disc == IX_REDEEM {
        let amount = r.u64()?;
        r.end()?;
        ix.expect(4)?;
        let pool = take(ix, 0)?;
        let user = take(ix, 1)?;
        let oracle = take(ix, 2)?;
        let system = take(ix, 3)?;
        if *pool.owner != pid || !pool.is_writable || !user.is_writable {
            return Err(err::BAD_ACCOUNTS);
        }
        if !user.is_signer {
            return Err(MISSING_SIGNATURE);
        }
        if oracle.data.len() < 16 || oracle.data[0..8] != ORACLE_MAGIC {
            return Err(BAD_ORACLE);
        }
        if cfg!(feature = "fixed") && *oracle.owner != ORACLE_OWNER {
            return Err(BAD_ORACLE);
        }
        let price = read_u64(&oracle.data[8..16]);
        if amount == 0 || amount > 1_000_000_000_000 {
            return Err(err::OUT_OF_BOUNDS);
        }
        system_transfer(&system, &user, &pool, amount, &[])?;
        let payout = (amount as u128 * price as u128 / 1_000_000) as u64;
        pay(&pool, &user, payout)?;
        Ok(())
    } else if disc == IX_CLOSE_RECEIPT {
        r.end()?;
        ix.expect(4)?;
        let pool = take(ix, 0)?;
        let receipt = take(ix, 1)?;
        let owner = take(ix, 2)?;
        let recipient = take(ix, 3)?;
        if *pool.owner != pid || !pool.is_writable || !recipient.is_writable || !receipt.is_writable {
            return Err(err::BAD_ACCOUNTS);
        }
        let credit = receipt_for(&receipt, &owner, &pid)?;
        pay(&pool, &recipient, credit)?;
        let rent = lamports(&receipt);
        pay(&receipt, &recipient, rent)?;
        if cfg!(feature = "fixed") {
            for b in receipt.data.iter_mut() {
                *b = 0;
            }
        }
        Ok(())
    } else if disc == IX_TOUCH_TREASURY {
        let bump = r.u8()?;
        r.end()?;
        ix.expect(3)?;
        let treasury = take(ix, 0)?;
        let payer = take(ix, 1)?;
        let system = take(ix, 2)?;
        if *system.key != SYSTEM {
            return Err(WRONG_PROGRAM);
        }
        if !payer.is_signer {
            return Err(MISSING_SIGNATURE);
        }
        let expected = if cfg!(feature = "fixed") {
            let (address, canonical) = cpi::find_program_address(&[b"treasury"], &pid)?;
            if bump != canonical {
                return Err(BAD_TREASURY);
            }
            address
        } else {
            cpi::create_program_address(&[b"treasury", &[bump]], &pid)?
        };
        if *treasury.key != expected {
            return Err(BAD_TREASURY);
        }
        system_transfer(&system, &payer, &treasury, 1_000_000, &[])
    } else {
        Err(err::BAD_INPUT)
    }
}

abi::entrypoint!(process);
