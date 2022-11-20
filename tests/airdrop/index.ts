import * as anchor from "@project-serum/anchor";
import { SaiCitizenship } from "../../target/types/sai_citizenship";

export const airdrop = async (
  program: anchor.Program<SaiCitizenship>,
  destination: anchor.web3.PublicKey
) => {
  const provider = program.provider as anchor.AnchorProvider;

  let txFund = new anchor.web3.Transaction();

  txFund.add(
    anchor.web3.SystemProgram.transfer({
      fromPubkey: provider.wallet.publicKey,
      toPubkey: destination,
      lamports: 5 * anchor.web3.LAMPORTS_PER_SOL,
    })
  );

  await provider.sendAndConfirm(txFund);
};
