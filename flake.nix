{
  description = "bench — dev toolchain for benchmark cells (pi workspaces) and validation";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.11";

  outputs = { self, nixpkgs }:
    let
      forAllSystems = nixpkgs.lib.genAttrs [ "x86_64-linux" "aarch64-linux" "aarch64-darwin" ];
    in {
      devShells = forAllSystems (system:
        let pkgs = nixpkgs.legacyPackages.${system};
        in {
          default = pkgs.mkShell {
            packages = with pkgs; [
              nodejs_24   # node + npm + npx; artifacts npm-install their own dev deps
              python3     # interpreter for scripts/run_bench.py (stdlib only)
              git
              jq
            ];
          };
        });
    };
}
