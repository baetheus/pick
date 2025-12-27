{
  description = "Deno Library: Magic String Routing";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/release-25.11";
  inputs.utils.url = "github:numtide/flake-utils";

  outputs = { self, nixpkgs, utils }:
    utils.lib.eachDefaultSystem (system: let
      pkgs = import nixpkgs {
        inherit system;
        config.allowUnfree = true;
      };
      shell = with pkgs; mkShell {
        # Insert Packages Here
        packages = [ deno esbuild claude-code ];
      };
    in {
      devShells.default = shell;
    });
}

