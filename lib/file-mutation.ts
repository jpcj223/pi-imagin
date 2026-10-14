export const FILE_MUTATION_EVENT = "pi-imagin:file-mutated";

export interface FileMutation {
  action: "rename" | "delete" | "restore";
  path: string;
  nextPath: string;
}
