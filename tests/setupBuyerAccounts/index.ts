import * as anchor from "@project-serum/anchor";
import { getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import { SaiCitizenship } from "../../target/types/sai_citizenship";
import { airdrop } from "../airdrop";

export const setupBuyerAccounts = async (
  program: anchor.Program<SaiCitizenship>,
  buyer: anchor.web3.Keypair,
  mintOwner: anchor.web3.Keypair,
  usdcMint: anchor.web3.PublicKey,
  otherTokenMint: anchor.web3.PublicKey
) => {
  await airdrop(program, buyer.publicKey);

  const programProvider = program.provider as anchor.AnchorProvider;

  const buyerUsdcTokenAccount = await getOrCreateAssociatedTokenAccount(
    programProvider.connection,
    mintOwner,
    usdcMint,
    buyer.publicKey
  );

  const buyerOtherTokenAccount = await getOrCreateAssociatedTokenAccount(
    programProvider.connection,
    buyer,
    otherTokenMint,
    buyer.publicKey
  );

  return {
    buyerUsdcTokenAccount,
    buyerOtherTokenAccount,
  };
};
