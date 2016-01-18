import _ from 'lodash';

export default function determineChangedRefs(seenCommits, previousRefInfo, refInfo) {
  // List of ref => SHA1
  // Refs added / refs deleted / refs changed
  // Result should be list of SHA1s to build, and list of SHA1s to cancel

  return _.filter(refInfo, (ref) => {
    if (seenCommits.has(ref.object.sha)) return false;
    seenCommits.add(ref.object.sha);

    return true;
  });
}
