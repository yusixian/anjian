module.exports = {
  getReleaseLine: async (changeset) => changeset.summary,
  getDependencyReleaseLine: async () => '',
};
