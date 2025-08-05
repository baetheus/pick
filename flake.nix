{
  description = "Deno Library: Magic String Routing";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/release-25.05";
  inputs.utils.url = "github:numtide/flake-utils";

  outputs = { self, nixpkgs, utils }:
    utils.lib.eachDefaultSystem (system: let
      pkgs = import nixpkgs { inherit system; };
      shell = with pkgs; mkShell {
        # Insert Packages Here
        packages = [ deno ];
      };
    in {
      devShells.default = shell;
    });
}

